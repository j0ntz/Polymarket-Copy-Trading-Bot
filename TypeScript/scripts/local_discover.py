#!/usr/bin/env python3
"""
Quick discovery and scoring of Polymarket traders.

Outputs JSON and CSV to TypeScript/trader_discovery_results/.

Heuristics to flag likely arbitrage/market-making traders:
 - high trades/day with very small average trade size
 - high ratio of very small trades
 - many quick opposite-side trades on same market (round-trips)

"""
import os
import re
import json
import math
import time
from collections import Counter, defaultdict
from datetime import datetime
from statistics import mean, median
import urllib.request

DATA_API = 'https://data-api.polymarket.com'
LEADERBOARD_URL = 'https://polymarket.com/leaderboard'
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'trader_discovery_results')
os.makedirs(OUT_DIR, exist_ok=True)

def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent':'polymarket-discover/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode()

def top_addresses_from_leaderboard(n=50):
    html = fetch(LEADERBOARD_URL)
    addrs = re.findall(r'0x[a-fA-F0-9]{40}', html)
    cnt = Counter(addrs)
    return [a for a,_ in cnt.most_common(n)]

def fetch_trades_for_user(addr, limit=500):
    url = f"{DATA_API}/activity?user={addr}&type=TRADE&limit={limit}"
    s = fetch(url)
    try:
        data = json.loads(s)
    except Exception:
        return []
    return data if isinstance(data, list) else []

def analyze_trades(trades):
    if not trades:
        return None
    ts = [t.get('timestamp') for t in trades if t.get('timestamp')]
    usdc = [float(t.get('usdcSize') or 0) for t in trades]
    slugs = [t.get('slug') or t.get('market') or '' for t in trades]
    sides = [t.get('side') or '' for t in trades]
    n = len(trades)
    newest = max(ts)
    oldest = min(ts)
    days_span = max(1e-6, (newest - oldest) / 86400.0)
    trades_per_day = n / days_span
    avg_size = mean(usdc) if usdc else 0
    med_size = median(usdc) if usdc else 0
    small_trades = sum(1 for v in usdc if v < 5)
    micro_ratio = small_trades / n
    markets_count = len(set(slugs))

    # quick round-trip detection: same slug, opposite side within 60s
    by_slug = defaultdict(list)
    for t in trades:
        slug = t.get('slug') or t.get('market') or ''
        by_slug[slug].append(t)

    round_trips = 0
    for slug, items in by_slug.items():
        items_sorted = sorted(items, key=lambda x: x.get('timestamp', 0))
        for i in range(len(items_sorted)-1):
            a = items_sorted[i]
            b = items_sorted[i+1]
            if a.get('side') and b.get('side') and a.get('side') != b.get('side'):
                dt = (b.get('timestamp') - a.get('timestamp'))
                if 0 <= dt <= 60:
                    round_trips += 1

    round_trip_ratio = round_trips / max(1, n)

    heur_arbitrage = (
        (trades_per_day > 500 and avg_size < 5) or
        (micro_ratio > 0.7 and trades_per_day > 200) or
        (round_trip_ratio > 0.05)
    )

    result = {
        'count': n,
        'first_ts': oldest,
        'last_ts': newest,
        'days_span': days_span,
        'trades_per_day': trades_per_day,
        'avg_trade_usdc': avg_size,
        'median_trade_usdc': med_size,
        'micro_trade_ratio': micro_ratio,
        'markets_count': markets_count,
        'round_trips': round_trips,
        'round_trip_ratio': round_trip_ratio,
        'likely_arbitrage_or_maker': bool(heur_arbitrage),
    }
    return result

def main():
    print('Discovering top addresses from Polymarket leaderboard...')
    addrs = top_addresses_from_leaderboard(50)
    print(f'Found {len(addrs)} addresses')
    results = []
    for i, a in enumerate(addrs, 1):
        print(f'[{i}/{len(addrs)}] Fetching trades for {a}...')
        trades = fetch_trades_for_user(a, limit=500)
        analysis = analyze_trades(trades)
        entry = {'address': a, 'trades_fetched': len(trades), 'analysis': analysis}
        results.append(entry)
        # be gentle on API
        time.sleep(0.2)

    timestamp = datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    out_json = os.path.join(OUT_DIR, f'discovery_{timestamp}.json')
    out_csv = os.path.join(OUT_DIR, f'discovery_{timestamp}.csv')
    with open(out_json, 'w') as f:
        json.dump(results, f, indent=2)

    # write CSV
    with open(out_csv, 'w') as f:
        f.write('address,trades_fetched,last_trade,trades_per_day,avg_trade_usdc,median_trade_usdc,micro_trade_ratio,markets_count,round_trip_ratio,likely_arbitrage\n')
        for r in results:
            a = r['address']
            an = r['analysis']
            if an is None:
                f.write(f'{a},0,,,,,,,,False\n')
            else:
                f.write(f"{a},{r['trades_fetched']},{datetime.utcfromtimestamp(an['last_ts']).isoformat()}Z,{an['trades_per_day']:.2f},{an['avg_trade_usdc']:.2f},{an['median_trade_usdc']:.2f},{an['micro_trade_ratio']:.2f},{an['markets_count']},{an['round_trip_ratio']:.3f},{an['likely_arbitrage_or_maker']}\n")

    print('Done. Results:')
    print(' JSON ->', out_json)
    print(' CSV  ->', out_csv)

if __name__ == '__main__':
    main()
