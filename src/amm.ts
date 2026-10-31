import type { Pool, Swap } from './types.ts';

/** Constant-product quote. Fee = floor(amountIn*feeBps/1e4) stays in the pool. */
export function quote(p: Pool, s: Swap): bigint {
  const fee = (s.amountIn * BigInt(p.feeBps)) / 10_000n;
  const ai = s.amountIn - fee;
  const [rin, rout] = s.dir === 'AtoB' ? [p.reserveA, p.reserveB] : [p.reserveB, p.reserveA];
  if (ai <= 0n || rin + ai === 0n) return 0n;
  return (rout * ai) / (rin + ai);
}

/** Apply a swap in place; returns amountOut. Caller checks minOut before calling. */
export function apply(p: Pool, s: Swap, out: bigint): void {
  if (s.dir === 'AtoB') { p.reserveA += s.amountIn; p.reserveB -= out; }
  else { p.reserveB += s.amountIn; p.reserveA -= out; }
}

export const clonePools = (ps: Pool[]): Map<string, Pool> => new Map(ps.map((p) => [p.id, { ...p }]));

/** Value an amount of token B in A at a pool's (pre-batch) spot price, floored. */
export const bToA = (p: Pool, b: bigint): bigint => (p.reserveB === 0n ? 0n : (b * p.reserveA) / p.reserveB);
