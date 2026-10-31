#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseBatch } from './fixtures.ts';
import { run, type ExternalSolver } from './pipeline.ts';
import type { TieBreak } from './canonical.ts';

const HELP = `simd-qubo-ordering — reference prototype (off-chain, not part of any validator)

Usage:
  node src/cli.ts <batch.json | -> [--tiebreak sha256|sha1-compat] [--iterations N] [--no-polish]
                  [--external-url URL] [--json]

  batch.json uses the shape of GET /api/simd420/demo?scenario=sandwich (see fixtures/).
  --external-url POSTs {n, ids, terms, offset} and expects {assignment: number[]} (optional quantum hook).
`;

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) { process.stdout.write(HELP); process.exit(args.length ? 0 : 1); }
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const src = args[0] === '-' ? readFileSync(0, 'utf8') : readFileSync(args[0]!, 'utf8');
const batch = parseBatch(JSON.parse(src));
const url = opt('--external-url');
const external: ExternalSolver | undefined = url ? {
  name: `external:${new URL(url).host}`, kind: 'quantum',
  async sample(q) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n: q.n, ids: q.ids, terms: q.terms, offset: q.offset }) });
    return (await r.json()).assignment;
  },
} : undefined;

const res = await run(batch, {
  tieBreak: (opt('--tiebreak') as TieBreak) ?? 'sha256',
  iterations: opt('--iterations') ? Number(opt('--iterations')) : undefined,
  polish: !args.includes('--no-polish'), external,
});

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(res, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
} else {
  const row = (name: string, f: (m: any) => string) => `${name.padEnd(32)}${[res.fcfs, res.optimized, res.canonical].map((r) => f(r.metrics).padStart(16)).join('')}`;
  console.log(`seed=${res.seed} txs=${res.qubo.n} qubo_vars=${res.qubo.variables} solver=${res.optimized.solver} ${res.optimized.ms}ms`);
  console.log(`${''.padEnd(32)}${'FCFS'.padStart(16)}${'optimized'.padStart(16)}${'canonical'.padStart(16)}`);
  console.log(row('MEV extracted (SOL)', (m) => m.mevExtractedSol.toFixed(4)));
  console.log(row('Avg slippage vs reference (%)', (m) => m.avgSlippagePct.toFixed(4)));
  console.log(row('Ordering loss to traders (SOL)', (m) => m.orderingLossSol.toFixed(4)));
  console.log(row('Fairness (Kendall vs arrival)', (m) => m.fairness.toFixed(3)));
  console.log(row('Reverted txs', (m) => String(m.reverts)));
  console.log(row('Objective score (lower=better)', (m) => Number(m.score).toLocaleString('en-US')));
  console.log(`\nFCFS:      ${res.fcfs.order.join(' → ')}`);
  console.log(`Optimized: ${res.optimized.order.join(' → ')}  (${res.optimized.fallbackUsed ? 'fallback: ' + res.optimized.fallbackReason : 'solver order accepted'})`);
  console.log(`Raw solver sample (pre-polish): ${res.optimized.rawSolverOrder.join(' → ')}`);
  console.log(`Canonical: ${res.canonical.order.join(' → ')}`);
  console.log(`State hash: ${res.optimized.stateHash}`);
}
