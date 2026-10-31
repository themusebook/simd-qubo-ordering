import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBatch, run, verify, encodeQubo, quboEnergy, permEnergy, permToAssignment, decodeAssignment, accept, canonicalOrder } from '../src/index.ts';

const b = loadBatch(new URL('../fixtures/sandwich.json', import.meta.url).pathname);

test('sandwich example reproduces the published table', async () => {
  const r = await run(b); // default proposal tie-break (sha256)
  assert.deepEqual(r.fcfs.order, ['atk-front', 'victim', 'atk-back']);
  assert.equal(r.fcfs.metrics.mevExtractedSol.toFixed(4), '2.7736');
  assert.equal(r.fcfs.metrics.avgSlippagePct.toFixed(3), '5.603');
  assert.equal(r.fcfs.metrics.orderingLossSol.toFixed(4), '2.6617');
  assert.equal(r.fcfs.metrics.score, 534465n);
  assert.deepEqual(r.optimized.order, ['atk-front', 'atk-back', 'victim']);
  assert.equal(r.optimized.fallbackUsed, false);
  assert.equal(r.optimized.metrics.mevExtractedLamports, 0n);
  assert.equal(r.optimized.metrics.avgSlippagePct.toFixed(3), '0.014');
  assert.equal(r.optimized.metrics.orderingLossSol.toFixed(4), '0.0066');
  assert.equal(r.optimized.metrics.fairness.toFixed(3), '0.667');
  assert.equal(r.optimized.metrics.score, 334023n);
  assert.equal(r.canonical.metrics.score, 334023n);
});

test('pipeline is deterministic (same inputs => identical result and state hash)', async () => {
  const a = await run(b), c = await run(b);
  assert.equal(a.optimized.stateHash, c.optimized.stateHash);
  assert.deepEqual(a.trace, c.trace);
  assert.deepEqual(a.optimized.rawSolverOrder, c.optimized.rawSolverOrder);
});

test('QUBO energy of a one-hot assignment equals the permutation energy; violations are penalised', () => {
  const q = encodeQubo(b);
  for (const p of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) assert.ok(Math.abs(quboEnergy(q, permToAssignment(q.n, p)) - permEnergy(q, p)) < 1e-6);
  const bad = new Uint8Array(q.n * q.n); bad[0] = 1; bad[1] = 1; // tx0 in two slots, others nowhere
  assert.ok(quboEnergy(q, bad) > q.penalty - 1);
  assert.equal(new Set(decodeAssignment(q, bad)).size, q.n);
});

test('verifier rejects non-permutations and new reverts; pipeline falls back to canonical', async () => {
  assert.equal(verify(b, ['victim', 'victim', 'atk-back']).pass, false);
  // victim with an impossible minOut reverts in every order => not a *new* revert, still passes
  const tight = { ...b, txs: b.txs.map((t) => (t.id === 'victim' ? { ...t, swap: { ...t.swap!, minOut: 47_505_655_435n } } : t)) };
  const v = verify(tight, ['atk-front', 'victim', 'atk-back']);
  assert.equal(v.metrics.reverts, 1);
  assert.equal(v.pass, true);
  // external hook that throws is ignored, SA result still used
  const r = await run(b, { external: { name: 'broken', kind: 'quantum', sample: async () => { throw new Error('qpu offline'); } } });
  assert.equal(r.optimized.solver, 'quantum-inspired-sa-tabu');
});

test('a solver that loses to canonical, or fails verification, triggers the fallback', () => {
  const canonical = verify(b, canonicalOrder(b));
  const lost = accept(b, ['atk-front', 'victim', 'atk-back'], canonical); // the sandwich itself
  assert.equal(lost.fallbackReason, 'solver-lost-to-canonical');
  assert.deepEqual(lost.chosen.order, canonical.order);
  const invalid = accept(b, ['atk-front', 'atk-front', 'victim'], canonical);
  assert.match(invalid.fallbackReason!, /^verifier-rejected:not-a-permutation/);
  assert.equal(accept(b, ['atk-front', 'atk-back', 'victim'], canonical).fallbackReason, null);
});
