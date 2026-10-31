// SPEC MODE — the amended noNewReverts baseline is the canonical order.
//
// Constructed batch where the two baselines DISAGREE:
//   pool 1e12 A / 1e12 B, 25 bps.
//   'early-low-fee'  arrival 0, fee 1000, swaps 1e11 A->B, minOut 0.
//   'late-high-fee'  arrival 1, fee 5000, swaps 1e10 A->B, minOut = its fresh-pool quote.
// FCFS runs the big low-fee swap first; the price move makes the high-fee swap
// miss its minOut and revert. Canonical (fee desc) runs the high-fee swap first,
// where it executes exactly at minOut, and nothing reverts.
// So the FCFS order's revert of 'late-high-fee' is NOT new against an FCFS
// baseline (legacy: pass) but IS new against the canonical baseline (spec: fail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify, canonicalOrder, fcfsOrder, revertBaselineOrder, LEGACY_VERIFY, SPEC_VERIFY, quote } from '../src/index.ts';
import type { Batch, Pool } from '../src/index.ts';

const pool: Pool = { id: 'pool-1', reserveA: 1_000_000_000_000n, reserveB: 1_000_000_000_000n, feeBps: 25 };
const ySwap = { pool: 'pool-1', dir: 'AtoB' as const, amountIn: 10_000_000_000n, minOut: 0n };
const yFreshOut = quote({ ...pool }, ySwap);

const batch: Batch = {
  slot: 0,
  seed: 'spec-baseline-seed',
  pools: [pool],
  txs: [
    { id: 'early-low-fee', owner: 'alice', arrival: 0, feeLamports: 1000, swap: { pool: 'pool-1', dir: 'AtoB', amountIn: 100_000_000_000n, minOut: 0n } },
    { id: 'late-high-fee', owner: 'bob', arrival: 1, feeLamports: 5000, swap: { ...ySwap, minOut: yFreshOut } },
  ],
  spec: { weights: { mev: 10, slippage: 5, fairness: 1, revert: 5 }, blockCuLimit: 48_000_000, accountCuLimit: 12_000_000, maxDisplacement: null, noNewReverts: true },
};

test('SPEC baseline: FCFS and canonical disagree on the revert set of this batch', () => {
  assert.deepEqual(fcfsOrder(batch), ['early-low-fee', 'late-high-fee']);
  assert.deepEqual(canonicalOrder(batch), ['late-high-fee', 'early-low-fee']);
  assert.deepEqual(revertBaselineOrder(batch, SPEC_VERIFY), ['late-high-fee', 'early-low-fee']);
  assert.deepEqual(revertBaselineOrder(batch, LEGACY_VERIFY), ['early-low-fee', 'late-high-fee']);
  const fcfs = verify(batch, fcfsOrder(batch), SPEC_VERIFY);
  assert.deepEqual(fcfs.metrics.revertedIds, ['late-high-fee']);
  const canon = verify(batch, canonicalOrder(batch), SPEC_VERIFY);
  assert.deepEqual(canon.metrics.revertedIds, []);
});

test('SPEC baseline: the FCFS order FAILS noNewReverts against the canonical baseline', () => {
  const v = verify(batch, ['early-low-fee', 'late-high-fee']); // default = spec mode
  assert.equal(v.pass, false);
  assert.deepEqual(v.violations, ['new-revert:late-high-fee']);
});

test('LEGACY baseline: the same FCFS order PASSES against the arrival baseline', () => {
  const v = verify(batch, ['early-low-fee', 'late-high-fee'], LEGACY_VERIFY);
  assert.equal(v.pass, true);
  assert.deepEqual(v.violations, []);
});

test('SPEC baseline: the canonical order itself passes, and state hash is mode-independent', () => {
  const spec = verify(batch, canonicalOrder(batch), SPEC_VERIFY);
  const legacy = verify(batch, canonicalOrder(batch), LEGACY_VERIFY);
  assert.equal(spec.pass, true);
  assert.equal(spec.stateHash, legacy.stateHash); // mode changes pass/fail only, never execution
});
