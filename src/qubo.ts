import type { Batch, Tx } from './types.ts';
import { quote, bToA } from './amm.ts';
import { batchNotional, roundTripOwners } from './verifier.ts';

/**
 * Permutation QUBO. Binary x[i*n+p] = 1 iff tx i is placed at position p.
 *   E(x) = A * sum_i (sum_p x_ip - 1)^2 + A * sum_p (sum_i x_ip - 1)^2
 *        + sum_{i != j} sum_{p < q} C[i][j] x_ip x_jq
 * C[i][j] is the pairwise surrogate cost of executing i before j (same score units as the verifier).
 * Path dependence beyond pairs is NOT captured; the verifier scores the exact objective.
 */
export interface Qubo {
  n: number;
  ids: string[];
  C: number[][]; // pairwise precedence cost
  penalty: number; // A
  offset: number; // constant term 2nA from expanding the one-hot squares
  /** Upper-triangular sparse terms over n^2 variables: [u, v, w] with u <= v (u == v => linear). */
  terms: Array<[number, number, number]>;
}

const E6 = 1_000_000;

function pairCost(b: Batch, i: Tx, j: Tx, mevOwners: Set<string>, notional: number, nNonMev: number, pairs: number): number {
  const w = b.spec.weights;
  let c = i.arrival > j.arrival ? (w.fairness * E6) / pairs : 0;
  if (!i.swap || !j.swap || i.swap.pool !== j.swap.pool) return c;
  const p0 = b.pools.find((p) => p.id === i.swap!.pool)!;
  const p = { ...p0 };
  // execute i, then j; charge j's degradation vs. its reference and any round-trip gain.
  const oi = quote(p, i.swap);
  if (oi >= i.swap.minOut) { if (i.swap.dir === 'AtoB') { p.reserveA += i.swap.amountIn; p.reserveB -= oi; } else { p.reserveB += i.swap.amountIn; p.reserveA -= oi; } }
  const oj = quote(p, j.swap);
  const refJ = quote({ ...p0 }, j.swap);
  if (oj < j.swap.minOut) c += w.revert * E6 / Math.max(1, b.txs.length);
  if (!mevOwners.has(j.owner) && refJ > 0n) {
    const d = Number(refJ - oj) / Number(refJ);
    c += (w.slippage * E6 * Math.max(0, d)) / Math.max(1, nNonMev);
  }
  if (mevOwners.has(i.owner) && i.owner === j.owner && i.swap.dir !== j.swap.dir) {
    // round trip i -> j: gain in A
    const gain = i.swap.dir === 'AtoB' ? Number(oj) - Number(i.swap.amountIn) : Number(bToA(p0, oj - j.swap.amountIn));
    if (gain > 0 && notional > 0) c += (w.mev * E6 * gain) / notional;
  }
  void bToA;
  return c;
}

export function encodeQubo(b: Batch): Qubo {
  const n = b.txs.length;
  const ids = b.txs.map((t) => t.id);
  const mevOwners = roundTripOwners(b.txs);
  const notional = Number(batchNotional(b));
  const nNonMev = b.txs.filter((t) => t.swap && !mevOwners.has(t.owner)).length;
  const pairs = Math.max(1, (n * (n - 1)) / 2);
  const C = b.txs.map((ti, a) => b.txs.map((tj, c) => (a === c ? 0 : pairCost(b, ti, tj, mevOwners, notional, nNonMev, pairs))));
  let maxRow = 0;
  for (const row of C) maxRow = Math.max(maxRow, row.reduce((s, v) => s + Math.abs(v), 0));
  const penalty = 1 + 2 * maxRow;
  const terms: Array<[number, number, number]> = [];
  const v = (i: number, p: number) => i * n + p;
  // one-hot penalties: (sum x - 1)^2 = -sum x + 2 sum_{a<b} x_a x_b + 1 (x^2 = x)
  for (let i = 0; i < n; i++) for (let p = 0; p < n; p++) terms.push([v(i, p), v(i, p), -2 * penalty]);
  for (let i = 0; i < n; i++) for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) terms.push([v(i, p), v(i, q), 2 * penalty]);
  for (let p = 0; p < n; p++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) terms.push([v(i, p), v(j, p), 2 * penalty]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j || C[i]![j] === 0) continue;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const a = v(i, p), c = v(j, q);
      terms.push(a <= c ? [a, c, C[i]![j]!] : [c, a, C[i]![j]!]);
    }
  }
  return { n, ids, C, penalty, offset: 2 * n * penalty, terms };
}

export function quboEnergy(q: Qubo, x: Uint8Array): number {
  let e = q.offset;
  for (const [a, c, w] of q.terms) if (x[a] && x[c]) e += w;
  return e;
}

/** Energy restricted to the feasible (permutation) subspace: sum over ordered pairs. */
export function permEnergy(q: Qubo, perm: number[]): number {
  let e = 0;
  for (let a = 0; a < perm.length; a++) for (let c = a + 1; c < perm.length; c++) e += q.C[perm[a]!]![perm[c]!]!;
  return e;
}

export function permToAssignment(n: number, perm: number[]): Uint8Array {
  const x = new Uint8Array(n * n);
  perm.forEach((i, p) => { x[i * n + p] = 1; });
  return x;
}

/** Decode any bitstring (e.g. from an external sampler) into a valid permutation, repairing greedily. */
export function decodeAssignment(q: Qubo, x: ArrayLike<number>): number[] {
  const n = q.n, used = new Set<number>(), perm: number[] = [];
  for (let p = 0; p < n; p++) {
    let pick = -1;
    for (let i = 0; i < n; i++) if (!used.has(i) && x[i * n + p]) { pick = i; break; }
    if (pick < 0) for (let i = 0; i < n; i++) if (!used.has(i)) { pick = i; break; }
    used.add(pick); perm.push(pick);
  }
  return perm;
}
