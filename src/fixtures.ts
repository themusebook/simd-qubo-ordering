import { readFileSync } from 'node:fs';
import type { Batch, Tx, Pool, Spec } from './types.ts';
import { DEFAULT_SPEC } from './types.ts';

/** Parse the JSON shape returned by GET /api/simd420/demo and /api/simd420/devnet. */
export function parseBatch(j: any): Batch {
  const pools: Pool[] = j.pools.map((p: any) => ({
    id: p.id, reserveA: BigInt(p.reserveA), reserveB: BigInt(p.reserveB), feeBps: p.feeBps,
  }));
  const txs: Tx[] = j.txs.map((t: any) => ({
    id: t.id, owner: t.owner, arrival: t.arrival, feeLamports: t.feeLamports,
    swap: t.swap ? { pool: t.swap.pool, dir: t.swap.dir, amountIn: BigInt(t.swap.amountIn), minOut: BigInt(t.swap.minOut) } : null,
  }));
  const spec: Spec = { ...DEFAULT_SPEC, ...(j.spec ?? {}), weights: { ...DEFAULT_SPEC.weights, ...(j.spec?.weights ?? {}) } };
  return { slot: j.slot ?? 0, seed: String(j.seed), pools, txs, spec };
}

export function loadBatch(path: string): Batch {
  return parseBatch(JSON.parse(readFileSync(path, 'utf8')));
}
