#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG = process.env.LOG_FILE || '/var/log/polybot.log';
const LINES = process.argv[2] || '5000';
const OUT_DIR = path.join(__dirname, '..', 'trader_discovery_results');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function tailLines(lines) {
  try {
    return execFileSync('tail', ['-n', lines, LOG], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    console.error('failed to read log with tail:', e.message || e);
    process.exit(2);
  }
}

const out = tailLines(LINES);
const lines = out.split(/\r?\n/);

const addRe = /Adding \$([0-9.]+).*aggregation buffer for (.*)/i;
const markets = new Map();
const addedSamples = new Map();
const aggregatedEvents = [];
const immediateEvents = [];

lines.forEach((L, idx) => {
  let m = addRe.exec(L);
  if (m) {
    const amt = parseFloat(m[1]);
    const market = m[2].trim();
    const cur = markets.get(market) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += amt;
    markets.set(market, cur);
    if (!addedSamples.has(market)) addedSamples.set(market, L);
  }
  if (/Aggregated/i.test(L)) aggregatedEvents.push({ idx, line: L });
  if (/IMMEDIATE TRADE/i.test(L)) immediateEvents.push({ idx, line: L });
});

const marketArray = Array.from(markets.entries()).map(([market, v]) => ({ market, count: v.count, total: v.total, avg: v.total / v.count, sample: addedSamples.get(market) }));
marketArray.sort((a, b) => b.total - a.total);

const now = new Date().toISOString().replace(/[:.]/g, '-');
const outJson = path.join(OUT_DIR, `recent_aggregations_${now}.json`);
const outCsv = path.join(OUT_DIR, `recent_aggregations_${now}.csv`);

const result = {
  generatedAt: new Date().toISOString(),
  logFile: LOG,
  linesTailed: LINES,
  addedCount: marketArray.reduce((s, m) => s + m.count, 0),
  markets: marketArray,
  aggregatedEventsCount: aggregatedEvents.length,
  immediateEventsCount: immediateEvents.length,
  aggregatedEvents: aggregatedEvents.slice(-200),
  immediateEvents: immediateEvents.slice(-200),
};

fs.writeFileSync(outJson, JSON.stringify(result, null, 2));

// write CSV: market,count,total,avg,sample
const hdr = 'market,count,total,avg,sample_line';
const csvLines = [hdr];
for (const m of marketArray) {
  // sanitize commas in market/sample
  const marketSafe = '"' + String(m.market).replace(/"/g, '""') + '"';
  const sampleSafe = '"' + String(m.sample || '').replace(/"/g, '""') + '"';
  csvLines.push([marketSafe, m.count, m.total.toFixed(2), m.avg.toFixed(2), sampleSafe].join(','));
}
fs.writeFileSync(outCsv, csvLines.join('\n'));

console.log(JSON.stringify({ json: outJson, csv: outCsv, summary: { markets: marketArray.length, added: result.addedCount, aggregated: result.aggregatedEventsCount, immediate: result.immediateEventsCount } }, null, 2));

process.exit(0);
