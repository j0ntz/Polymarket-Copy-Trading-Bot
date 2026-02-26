import { ethers } from 'ethers';
import { ClobClient, OrderType, Side, AssetType } from '@polymarket/clob-client';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';
import { POLYMARKET_API } from '../utils/constants';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL || 'https://polygon-rpc.com';

// How often to check for resolved positions (ms)
const REAP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Contract addresses on Polygon
const CTF_CONTRACT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// Thresholds
const RESOLVED_HIGH = 0.99;
const RESOLVED_LOW = 0.01;
const ZERO_THRESHOLD = 0.0001;
const MIN_SELL_TOKENS = 1.0;

// CTF ABI for on-chain redemption
const CTF_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] calldata indexSets) external',
    'function balanceOf(address owner, uint256 tokenId) external view returns (uint256)',
];

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    curPrice: number;
    title?: string;
    outcome?: string;
    slug?: string;
    redeemable?: boolean;
}

let isRunning = true;

/**
 * Stop the position reaper gracefully
 */
export const stopPositionReaper = (): void => {
    isRunning = false;
    Logger.info('Position reaper shutdown requested...');
};

/**
 * Load all positions for our wallet
 */
const loadPositions = async (): Promise<Position[]> => {
    const url = `${POLYMARKET_API.DATA_API_BASE}${POLYMARKET_API.POSITIONS_ENDPOINT}?user=${PROXY_WALLET}`;
    const data = await fetchData(url);
    const positions = Array.isArray(data) ? (data as Position[]) : [];
    return positions.filter((pos) => (pos.size || 0) > ZERO_THRESHOLD);
};

/**
 * Try to sell a resolved position on the order book.
 * Returns the number of tokens successfully sold.
 */
const tryOrderBookSell = async (
    clobClient: ClobClient,
    position: Position
): Promise<number> => {
    let remaining = position.size;
    let soldTokens = 0;
    let attempts = 0;
    const maxAttempts = 3;

    // Refresh balance cache
    try {
        await clobClient.updateBalanceAllowance({
            asset_type: AssetType.CONDITIONAL,
            token_id: position.asset,
        });
    } catch {
        // Non-fatal
    }

    while (remaining >= MIN_SELL_TOKENS && attempts < maxAttempts) {
        let orderBook;
        try {
            orderBook = await clobClient.getOrderBook(position.asset);
        } catch {
            // Order book doesn't exist (404) — market fully resolved
            return soldTokens;
        }

        if (!orderBook.bids || orderBook.bids.length === 0) {
            return soldTokens;
        }

        const bestBid = orderBook.bids.reduce((max: any, bid: any) => {
            return parseFloat(bid.price) > parseFloat(max.price) ? bid : max;
        }, orderBook.bids[0]);

        const bidSize = parseFloat(bestBid.size);
        const bidPrice = parseFloat(bestBid.price);

        if (bidSize < MIN_SELL_TOKENS) {
            return soldTokens;
        }

        const sellAmount = Math.min(remaining, bidSize);
        if (sellAmount < MIN_SELL_TOKENS) {
            return soldTokens;
        }

        try {
            const signedOrder = await clobClient.createMarketOrder({
                side: Side.SELL,
                tokenID: position.asset,
                amount: sellAmount,
                price: bidPrice,
            });
            const resp = await clobClient.postOrder(signedOrder, OrderType.FOK);

            if (resp.success === true) {
                soldTokens += sellAmount;
                remaining -= sellAmount;
                attempts = 0;
                Logger.info(
                    `   ✅ Sold ${sellAmount.toFixed(2)} tokens @ $${bidPrice.toFixed(3)} (≈ $${(sellAmount * bidPrice).toFixed(2)})`
                );
            } else {
                attempts++;
                const errorMsg =
                    typeof resp === 'object' && resp !== null && 'error' in resp
                        ? String((resp as any).error)
                        : 'unknown';
                if (errorMsg.toLowerCase().includes('not enough balance')) {
                    break;
                }
            }
        } catch {
            attempts++;
        }
    }

    return soldTokens;
};

/**
 * Redeem a resolved position on-chain via the CTF contract.
 * Returns true if successful.
 */
const tryOnChainRedeem = async (
    ctfContract: ethers.Contract,
    position: Position
): Promise<boolean> => {
    try {
        const conditionIdBytes32 = ethers.utils.hexZeroPad(
            ethers.BigNumber.from(position.conditionId).toHexString(),
            32
        );
        const parentCollectionId = ethers.constants.HashZero;
        const indexSets = [1, 2];

        const feeData = await ctfContract.provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
        if (!gasPrice) {
            Logger.warning('   Could not determine gas price, skipping redemption');
            return false;
        }

        const adjustedGasPrice = gasPrice.mul(120).div(100);

        const tx = await ctfContract.redeemPositions(
            USDC_ADDRESS,
            parentCollectionId,
            conditionIdBytes32,
            indexSets,
            { gasLimit: 500000, gasPrice: adjustedGasPrice }
        );

        Logger.info(`   ⏳ Redeem TX submitted: ${tx.hash}`);
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            Logger.info(
                `   ✅ Redeemed on-chain! Gas: ${receipt.gasUsed.toString()} | TX: https://polygonscan.com/tx/${tx.hash}`
            );
            return true;
        } else {
            Logger.warning(`   ❌ Redeem TX reverted`);
            return false;
        }
    } catch (error: any) {
        Logger.warning(`   ❌ Redeem failed: ${error.message || error}`);
        return false;
    }
};

/**
 * Single reap cycle: check positions, close/redeem any resolved ones.
 */
const reapCycle = async (
    clobClient: ClobClient,
    ctfContract: ethers.Contract
): Promise<void> => {
    const allPositions = await loadPositions();
    if (allPositions.length === 0) return;

    const resolved = allPositions.filter(
        (pos) => pos.curPrice >= RESOLVED_HIGH || pos.curPrice <= RESOLVED_LOW
    );

    if (resolved.length === 0) return;

    Logger.info(`🪓 Position reaper: found ${resolved.length} resolved position(s) to close`);

    // Group by conditionId for redemption (one redeem call covers both outcomes)
    const conditionsSeen = new Set<string>();

    for (const position of resolved) {
        const label = position.title || position.slug || position.asset.slice(0, 10);
        const status = position.curPrice >= RESOLVED_HIGH ? 'WIN' : 'LOSS';
        Logger.info(
            `   ${status === 'WIN' ? '🎉' : '❌'} ${label} | ${position.outcome || ''} | ${position.size.toFixed(2)} tokens | ~$${position.currentValue.toFixed(2)}`
        );

        // Step 1: Try selling on order book (gets best price, no gas cost)
        if (position.size >= MIN_SELL_TOKENS) {
            const sold = await tryOrderBookSell(clobClient, position);
            if (sold > 0) {
                Logger.info(`   📊 Sold ${sold.toFixed(2)} tokens via order book`);
            }

            // If fully sold, done with this position
            if (sold >= position.size - ZERO_THRESHOLD) {
                continue;
            }
        }

        // Step 2: If order book didn't work and position is redeemable, redeem on-chain
        if (position.redeemable && !conditionsSeen.has(position.conditionId)) {
            conditionsSeen.add(position.conditionId);
            Logger.info(`   🔗 Order book unavailable, attempting on-chain redemption...`);
            await tryOnChainRedeem(ctfContract, position);
        }
    }
};

/**
 * Main position reaper loop.
 * Periodically checks for resolved positions and closes/redeems them.
 */
const positionReaper = async (clobClient: ClobClient): Promise<void> => {
    Logger.success(`Position reaper started (checking every ${REAP_INTERVAL_MS / 60000} minutes)`);

    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const ctfContract = new ethers.Contract(CTF_CONTRACT_ADDRESS, CTF_ABI, wallet);

    while (isRunning) {
        try {
            await reapCycle(clobClient, ctfContract);
        } catch (error: any) {
            Logger.warning(`Position reaper error: ${error.message || error}`);
        }

        // Sleep in small increments so we can exit quickly on shutdown
        const sleepEnd = Date.now() + REAP_INTERVAL_MS;
        while (isRunning && Date.now() < sleepEnd) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    Logger.info('Position reaper stopped');
};

export default positionReaper;
