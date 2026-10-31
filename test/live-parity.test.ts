// Parity with the live devnet prototype: fixtures are verbatim responses captured 2026-10-31 from
// GET https://clawd-pump-api-devnet.onrender.com/api/simd420/{demo?scenario=sandwich,demo?scenario=mixed,devnet}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBatch, verify, run, canonicalOrder, fcfsOrder } from '../src/index.ts';

const raw = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/${n}.json`, import.meta.url), 'utf8'));
const pick = (m: any) => ({ mev: String(m.mevExtractedLamports), slip: m.avgSlippagePct, loss: Number(m.orderingLossSol.toFixed(9)), fair: m.fairness, reverts: m.reverts, cu: m.totalCu, score: String(m.score) });

for (const name of ['sandwich', 'mixed', 'devnet']) {
  const j = raw(name), b = parseBatch(j);
  for (const k of ['fcfs', 'optimized', 'canonical'] as const) {
    test(`${name}: verifier reproduces live ${k} metrics for the live order`, () => {
      const v = verify(b, j[k].order);
      assert.equal(v.pass, true);
      assert.deepEqual(pick(v.metrics), pick({ ...j[k].metrics, mevExtractedLamports: j[k].metrics.mevExtractedLamports }));
    });
  }
  test(`${name}: FCFS and sha1-compat canonical orders match live`, () => {
    assert.deepEqual(fcfsOrder(b), j.fcfs.order);
    assert.deepEqual(canonicalOrder(b, 'sha1-compat'), j.canonical.order);
  });
  test(`${name}: solver result is accepted and no worse than the live optimized score`, async () => {
    const r = await run(b, { tieBreak: 'sha1-compat' });
    assert.equal(r.optimized.pass, true);
    assert.ok(r.optimized.metrics.score <= BigInt(j.optimized.metrics.score), `${r.optimized.metrics.score} > ${j.optimized.metrics.score}`);
  });
}
