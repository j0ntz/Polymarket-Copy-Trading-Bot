import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';

type Position = {
    asset?: string;
    title?: string;
    outcome?: string;
    size?: number;
    avgPrice?: number;
    curPrice?: number;
    currentValue?: number;
    cashPnl?: number;
    percentPnl?: number;
    realizedPnl?: number;
};

type PositionReport = {
    positionId: string;
    symbol: string;
    side: string;
    size: number;
    entryPrice: number | null;
    markPrice: number | null;
    positionValue: number;
    unrealizedPnl: number;
    unrealizedPnlPercent: number;
    realizedPnl: number;
};

type StatsPayload = {
    ok: boolean;
    timestamp: string;
    wallet: string;
    spendableCapital: number;
    openPositionValue: number;
    openPositionPnl: number;
    openPositionPnlPercent: number;
    totalPortfolioValue: number;
    positionsCount: number;
    positions: PositionReport[];
    source: 'proxy_wallet_only';
    errors?: string[];
};

const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function mkPositionReport(positions: Position[]): PositionReport[] {
    const out = positions.map((p) => {
        const size = toNum(p.size);
        const entryPrice = Number.isFinite(toNum(p.avgPrice)) && toNum(p.avgPrice) > 0 ? toNum(p.avgPrice) : null;
        const markPrice = Number.isFinite(toNum(p.curPrice)) && toNum(p.curPrice) > 0 ? toNum(p.curPrice) : null;

        const unrealizedPnl = toNum(p.cashPnl);
        const unrealizedPnlPercent = toNum(p.percentPnl);

        return {
            positionId: p.asset || p.title || 'unknown',
            symbol: p.title || p.asset || 'unknown',
            side: p.outcome || 'N/A',
            size,
            entryPrice,
            markPrice,
            positionValue: toNum(p.currentValue),
            unrealizedPnl,
            unrealizedPnlPercent,
            realizedPnl: toNum(p.realizedPnl),
        };
    });

    return out.sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
}

async function main(): Promise<void> {
    const wallet = ENV.PROXY_WALLET;
    const errors: string[] = [];

    let spendableCapital: number | null = null;
    let positions: Position[] | null = null;

    try {
        spendableCapital = await getMyBalance(wallet);
    } catch (e) {
        errors.push(`usdc_balance_failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
        const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
        positions = await fetchData<Position[]>(url);
    } catch (e) {
        errors.push(`positions_fetch_failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (spendableCapital === null || positions === null) {
        const failed = {
            ok: false,
            timestamp: new Date().toISOString(),
            wallet,
            source: 'proxy_wallet_only',
            errors,
            requiredFieldsMissing: [
                ...(spendableCapital === null ? ['spendableCapital'] : []),
                ...(positions === null
                    ? ['openPositionValue', 'openPositionPnl', 'totalPortfolioValue', 'positions']
                    : []),
            ],
        };
        console.log(JSON.stringify(failed, null, 2));
        process.exit(2);
    }

    const openPositionValue = positions.reduce((sum, p) => sum + toNum(p.currentValue), 0);
    const openPositionPnl = positions.reduce((sum, p) => sum + toNum(p.cashPnl), 0);
    const totalCostBasis = positions.reduce((sum, p) => sum + toNum(p.currentValue) - toNum(p.cashPnl), 0);
    const openPositionPnlPercent = totalCostBasis > 0 ? (openPositionPnl / totalCostBasis) * 100 : 0;
    const totalPortfolioValue = spendableCapital + openPositionValue;

    const payload: StatsPayload = {
        ok: true,
        timestamp: new Date().toISOString(),
        wallet,
        spendableCapital,
        openPositionValue,
        openPositionPnl,
        openPositionPnlPercent,
        totalPortfolioValue,
        positionsCount: positions.length,
        positions: mkPositionReport(positions),
        source: 'proxy_wallet_only',
    };

    console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
    console.error(
        JSON.stringify(
            {
                ok: false,
                timestamp: new Date().toISOString(),
                error: e instanceof Error ? e.message : String(e),
            },
            null,
            2
        )
    );
    process.exit(1);
});
