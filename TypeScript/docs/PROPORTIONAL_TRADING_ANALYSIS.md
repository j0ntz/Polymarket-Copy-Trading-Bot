# Getting Started: Which Traders to Follow by Starting Capital

Date: 2026-02-22

## Goal

Determine a starter proportional copy-trading setup, then estimate historical copy-trade PnL for:

- `$100` starting capital
- `$500` starting capital
- `$1,000` starting capital

## Proportional setup (starter)

Use the repo's proportional model as percentage copy sizing:

- `COPY_STRATEGY=PERCENTAGE`
- `COPY_SIZE=(your_equity / trader_equity) * 100`

Example:

- Your equity: `$500`
- Trader equity: `$250,000`
- `COPY_SIZE = (500 / 250000) * 100 = 0.2`

Then cap risk:

```env
COPY_STRATEGY=PERCENTAGE
COPY_SIZE=0.25
MAX_ORDER_SIZE_USD=50
MIN_ORDER_SIZE_USD=1
TIERED_MULTIPLIERS=1-100:1.5,100-1000:1.0,1000-10000:0.3,10000+:0.1
```

## Analysis process used

1. Candidate discovery from Polymarket leaderboard wallets with high month performance.
2. Pull recent trader activity (`type=TRADE`) over a 30-day window.
3. Simulate copy logic using repo-style sizing assumptions:
   - copy 10% of trader order (`COPY_PERCENTAGE=10`)
   - skip orders below `$1`
   - reduce order to `99%` of available balance when needed
4. Compute realized + mark-to-last-trade unrealized PnL.

> Note: In this environment, Node/axios script paths to `data-api.polymarket.com/activity` hit proxy redirect issues. For this run, data pull and simulation were executed via direct HTTP calls in Python with the same copy-sizing assumptions.

## Results (30-day historical simulation)

| Trader | Address | Trades Used | PnL @ $100 | PnL @ $500 | PnL @ $1,000 |
|---|---|---:|---:|---:|---:|
| beachboy4 | `0xc2e7800b5af46e6093872b177b7a5e7f0563be51` | 1000 | +$49.80 (49.8%) | +$249.70 (49.9%) | +$499.99 (50.0%) |
| FeatherLeather | `0xd25c72ac0928385610611c8148803dc717334d20` | 672 | +$3.60 (3.6%) | +$18.18 (3.6%) | +$36.40 (3.6%) |
| KeyTransporter | `0x94f199fb7789f1aef7fff6b758d6b375100f4c7a` | 1000 | +$0.18 (0.2%) | +$0.18 (0.0%) | +$0.30 (0.0%) |
| DrPufferfish | `0xdb27bf2ac5d428a9c63dbc914611036855a6c56e` | 1000 | -$0.00 (-0.0%) | -$0.00 (-0.0%) | -$0.00 (-0.0%) |
| blackwall | `0xac44cb78be973ec7d91b69678c4bdfa7009afbd7` | 1000 | -$1.59 (-1.6%) | -$7.94 (-1.6%) | -$15.87 (-1.6%) |
| kch123 | `0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee` | 1000 | -$78.59 (-78.6%) | -$92.93 (-18.6%) | -$92.93 (-9.3%) |

## Recommended starter picks

If you want to get started immediately from this run:

1. **beachboy4** (best historical signal in this sample)
2. **FeatherLeather** (modest positive, lower apparent volatility)
3. **Optional tiny allocation:** KeyTransporter (near-flat in this simulation)

Avoid (for now) from this sample:

- `kch123` (large negative)
- `blackwall` (slight negative)

## Suggested initial allocation by starting capital

- **$100 total**: beachboy4 70%, FeatherLeather 30%
- **$500 total**: beachboy4 60%, FeatherLeather 30%, KeyTransporter 10%
- **$1,000 total**: beachboy4 50%, FeatherLeather 30%, KeyTransporter 20%

Re-evaluate weekly and replace traders whose 30-day result turns negative.
