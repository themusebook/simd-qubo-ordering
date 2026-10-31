import { createHash } from 'node:crypto';
import type { Batch } from './types.ts';

/**
 * Tie-break hash used inside equal-fee groups.
 * - 'sha256' (proposal default): sha256("simd-qubo-ordering/canonical/v1:" + seed + ":" + id), ascending.
 * - 'sha1-compat': sha1("simd420:" + seed + ":" + id), ascending. This variant reproduces every canonical
 *   order returned by the live devnet prototype in our captured fixtures; it was inferred, not read from source.
 */
export type TieBreak = 'sha256' | 'sha1-compat';

export function tieKey(seed: string, id: string, tb: TieBreak): string {
  return tb === 'sha256'
    ? createHash('sha256').update(`simd-qubo-ordering/canonical/v1:${seed}:${id}`).digest('hex')
    : createHash('sha1').update(`simd420:${seed}:${id}`).digest('hex');
}

/** Canonical fallback order: priority fee desc, then seeded hash asc. Total and deterministic. */
export function canonicalOrder(b: Batch, tb: TieBreak = 'sha256'): string[] {
  return [...b.txs]
    .map((t) => ({ t, k: tieKey(b.seed, t.id, tb) }))
    .sort((x, y) => y.t.feeLamports - x.t.feeLamports || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map((x) => x.t.id);
}

export const fcfsOrder = (b: Batch): string[] => [...b.txs].sort((x, y) => x.arrival - y.arrival || (x.id < y.id ? -1 : 1)).map((t) => t.id);
