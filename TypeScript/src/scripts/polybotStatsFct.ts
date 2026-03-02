import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';

type Position = {
    currentValue?: number;
    cashPnl?: number;
};

type StatsPayload = {
    ok: boolean;
    timestamp: string;
    wallet: string;
    spendableCapital: number;
    openPositionValue: number;
    openPositionPnl: number;
    totalPortfolioValue: number;
    positionsCount: number;
    source: 'proxy_wallet_only';
    errors?: string[];
};

const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

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

    // Fail-closed: do not emit normal stats if either critical source is unavailable
    if (spendableCapital === null || positions === null) {
        const failed = {
            ok: false,
            timestamp: new Date().toISOString(),
            wallet,
            source: 'proxy_wallet_only',
            errors,
            requiredFieldsMissing: [
                ...(spendableCapital === null ? ['spendableCapital'] : []),
                ...(positions === null ? ['openPositionValue', 'openPositionPnl', 'totalPortfolioValue'] : []),
            ],
        };
        console.log(JSON.stringify(failed, null, 2));
        process.exit(2);
    }

    const openPositionValue = positions.reduce((sum, p) => sum + toNum(p.currentValue), 0);
    const openPositionPnl = positions.reduce((sum, p) => sum + toNum(p.cashPnl), 0);
    const totalPortfolioValue = spendableCapital + openPositionValue;

    const payload: StatsPayload = {
        ok: true,
        timestamp: new Date().toISOString(),
        wallet,
        spendableCapital,
        openPositionValue,
        openPositionPnl,
        totalPortfolioValue,
        positionsCount: positions.length,
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
