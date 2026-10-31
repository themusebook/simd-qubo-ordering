import { createHash } from 'node:crypto';
import type { Batch, Metrics, Tx, VerifyResult } from './types.ts';
import { CU_SWAP, CU_TRANSFER } from './types.ts';
import { apply, bToA, clonePools, quote } from './amm.ts';

const E6 = 1_000_000n;
const LAMPORTS = 1e9;

/** Owners that swap both directions on the same pool inside the batch (sandwich/round-trip pattern). */
export function roundTripOwners(txs: Tx[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const t of txs) {
    if (!t.swap) continue;
    const k = `${t.owner}\u0000${t.swap.pool}`;
    (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(t.swap.dir);
  }
  const out = new Set<string>();
  for (const [k, dirs] of seen) if (dirs.size === 2) out.add(k.split('\u0000')[0]!);
  return out;
}

/** Notional of the batch in A units at pre-batch spot prices (normaliser for the MEV term). */
export function batchNotional(b: Batch): bigint {
  const pools = new Map(b.pools.map((p) => [p.id, p]));
  let v = 0n;
  for (const t of b.txs) if (t.swap) v += t.swap.dir === 'AtoB' ? t.swap.amountIn : bToA(pools.get(t.swap.pool)!, t.swap.amountIn);
  return v;
}

export interface SimOutcome { executed: Map<string, bigint>; reverted: string[]; poolsAfter: Map<string, import('./types.ts').Pool> }

/** Deterministically re-simulate the batch in `order` against the constant-product pools. */
export function simulate(b: Batch, order: string[]): SimOutcome {
  const pools = clonePools(b.pools);
  const byId = new Map(b.txs.map((t) => [t.id, t]));
  const executed = new Map<string, bigint>();
  const reverted: string[] = [];
  for (const id of order) {
    const t = byId.get(id)!;
    if (!t.swap) continue;
    const p = pools.get(t.swap.pool);
    if (!p) { reverted.push(id); continue; }
    const out = quote(p, t.swap);
    const reserveOut = t.swap.dir === 'AtoB' ? p.reserveB : p.reserveA;
    if (out <= 0n || out >= reserveOut || out < t.swap.minOut) { reverted.push(id); continue; }
    apply(p, t.swap, out);
    executed.set(id, out);
  }
  return { executed, reverted, poolsAfter: pools };
}

export function kendallDiscordant(b: Batch, order: string[]): { disc: number; pairs: number } {
  const arr = new Map(b.txs.map((t) => [t.id, t.arrival]));
  let disc = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++) if (arr.get(order[i]!)! > arr.get(order[j]!)!) disc++;
  return { disc, pairs: (order.length * (order.length - 1)) / 2 };
}

export function score(b: Batch, order: string[]): Metrics & { _sim: SimOutcome } {
  const w = b.spec.weights;
  const sim = simulate(b, order);
  const pools0 = new Map(b.pools.map((p) => [p.id, p]));
  const mevOwners = roundTripOwners(b.txs);
  const byId = new Map(b.txs.map((t) => [t.id, t]));

  // MEV: realised profit of round-trip owners, valued in A at pre-batch spot, clamped >= 0 per owner.
  const net = new Map<string, { a: bigint; bb: Map<string, bigint> }>();
  let slipSumE18 = 0n, slipN = 0n, loss = 0n;
  for (const id of order) {
    const t = byId.get(id)!;
    if (!t.swap || !sim.executed.has(id)) continue;
    const out = sim.executed.get(id)!;
    const p0 = pools0.get(t.swap.pool)!;
    if (mevOwners.has(t.owner)) {
      const n = net.get(t.owner) ?? net.set(t.owner, { a: 0n, bb: new Map() }).get(t.owner)!;
      const db = n.bb.get(t.swap.pool) ?? 0n;
      if (t.swap.dir === 'AtoB') { n.a -= t.swap.amountIn; n.bb.set(t.swap.pool, db + out); }
      else { n.a += out; n.bb.set(t.swap.pool, db - t.swap.amountIn); }
    } else {
      const ref = quote({ ...p0 }, t.swap); // execution alone against pre-batch state
      const d = ref - out;
      loss += t.swap.dir === 'AtoB' ? bToA(p0, d) : d;
      if (ref > 0n) slipSumE18 += d > 0n ? (d * E6) / ref : 0n; // per-tx floor to 1e-6 (matches live prototype)
      slipN++;
    }
  }
  let mev = 0n;
  for (const n of net.values()) {
    let v = n.a;
    for (const [pid, db] of n.bb) v += bToA(pools0.get(pid)!, db);
    if (v > 0n) mev += v;
  }
  const notional = batchNotional(b);
  const mevE6 = notional > 0n ? (mev * E6) / notional : 0n;
  const slipE6 = slipN > 0n ? slipSumE18 / slipN : 0n;
  const { disc, pairs } = kendallDiscordant(b, order);
  const discE6 = pairs > 0 ? (BigInt(disc) * E6) / BigInt(pairs) : 0n;
  const nSw = BigInt(Math.max(1, b.txs.length));
  const revE6 = (BigInt(sim.reverted.length) * E6) / nSw;
  const s = BigInt(w.mev) * mevE6 + BigInt(w.slippage) * slipE6 + BigInt(w.fairness) * discE6 + BigInt(w.revert) * revE6;
  const totalCu = b.txs.reduce((c, t) => c + (t.swap ? CU_SWAP : CU_TRANSFER), 0);
  return {
    mevExtractedLamports: mev,
    mevExtractedSol: Number(mev) / LAMPORTS,
    avgSlippagePct: Number(slipE6) / 1e4,
    orderingLossLamports: loss,
    orderingLossSol: Number(loss) / LAMPORTS,
    fairness: Number(E6 - discE6) / 1e6,
    reverts: sim.reverted.length,
    revertedIds: sim.reverted,
    totalCu,
    score: s,
    _sim: sim,
  };
}

/** Full verifier: permutation validity, constraints, then deterministic metrics + state hash. */
export function verify(b: Batch, order: string[]): VerifyResult {
  const violations: string[] = [];
  const ids = b.txs.map((t) => t.id);
  const set = new Set(order);
  if (order.length !== ids.length || set.size !== ids.length || !ids.every((i) => set.has(i))) {
    violations.push('not-a-permutation');
  }
  const m = score(b, violations.length ? ids : order);
  const fcfs = [...b.txs].sort((x, y) => x.arrival - y.arrival).map((t) => t.id);
  if (b.spec.noNewReverts) {
    const base = new Set(simulate(b, fcfs).reverted);
    for (const r of m.revertedIds) if (!base.has(r)) violations.push(`new-revert:${r}`);
  }
  if (m.totalCu > b.spec.blockCuLimit) violations.push('block-cu-limit');
  const perAcct = new Map<string, number>();
  for (const t of b.txs) if (t.swap) perAcct.set(t.swap.pool, (perAcct.get(t.swap.pool) ?? 0) + CU_SWAP);
  for (const [a, cu] of perAcct) if (cu > b.spec.accountCuLimit) violations.push(`account-cu-limit:${a}`);
  if (b.spec.maxDisplacement != null) {
    const rank = new Map(fcfs.map((id, i) => [id, i]));
    order.forEach((id, i) => { if (Math.abs(i - (rank.get(id) ?? i)) > b.spec.maxDisplacement!) violations.push(`displacement:${id}`); });
  }
  const { _sim, ...metrics } = m;
  const h = createHash('sha256');
  h.update(`simd-qubo-ordering/v1|${b.seed}|${order.join(',')}|`);
  for (const p of [..._sim.poolsAfter.values()].sort((x, y) => (x.id < y.id ? -1 : 1))) h.update(`${p.id}:${p.reserveA}:${p.reserveB};`);
  for (const id of order) h.update(`${id}=${_sim.executed.get(id) ?? (metrics.revertedIds.includes(id) ? 'R' : '-')};`);
  return { order, pass: violations.length === 0, violations, metrics, stateHash: h.digest('hex') };
}
