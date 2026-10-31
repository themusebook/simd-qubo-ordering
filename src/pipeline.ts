import type { Batch, VerifyResult } from './types.ts';
import { encodeQubo, decodeAssignment, permEnergy, type Qubo } from './qubo.ts';
import { solveSaTabu, type SolverResult } from './solver.ts';
import { verify, type VerifyOptions } from './verifier.ts';
import { canonicalOrder, fcfsOrder, type TieBreak } from './canonical.ts';

/** Optional external (e.g. quantum annealer / QAOA) sampler. Must return a bitstring over n*n vars. */
export interface ExternalSolver { name: string; kind: 'quantum' | 'classical'; sample(q: Qubo, timeoutMs: number): Promise<ArrayLike<number>> }

export interface RunOptions {
  tieBreak?: TieBreak;
  /** noNewReverts baseline: 'canonical' (spec, default) or 'fcfs' (legacy live-parity mode). */
  baseline?: VerifyOptions['baseline'];
  iterations?: number;
  polish?: boolean;
  external?: ExternalSolver;
  externalTimeoutMs?: number;
}

export interface RunResult {
  seed: string;
  fcfs: VerifyResult;
  canonical: VerifyResult;
  optimized: VerifyResult & {
    source: 'solver' | 'canonical-fallback';
    fallbackUsed: boolean;
    fallbackReason: string | null;
    solver: string;
    solverKind: 'quantum-inspired' | 'quantum' | 'classical';
    energy: number;
    rawSolverOrder: string[];
    ms: number;
  };
  trace: SolverResult['trace'];
  qubo: { n: number; variables: number; terms: number; penalty: number };
}

/**
 * Exact-objective polish: best-improvement local search over single insertions, run from each start
 * (raw solver sample first), returning the lowest verified score. Deterministic; ties keep the earlier start.
 */
export function polish(b: Batch, starts: string[][], maxRounds = 100, opts: VerifyOptions = {}): string[] {
  let gBest = starts[0]!, gS = verify(b, gBest, opts);
  for (const start of starts) {
    let best = start, bs = verify(b, best, opts);
    for (let r = 0; r < maxRounds; r++) {
      let nb = best, ns = bs;
      for (let i = 0; i < best.length; i++) for (let j = 0; j < best.length; j++) {
        if (i === j) continue;
        const c = [...best]; const [m] = c.splice(i, 1); c.splice(j, 0, m!);
        const v = verify(b, c, opts);
        if (v.pass && (!ns.pass || v.metrics.score < ns.metrics.score)) { nb = c; ns = v; }
      }
      if (nb === best) break;
      best = nb; bs = ns;
    }
    if (bs.pass && (!gS.pass || bs.metrics.score < gS.metrics.score)) { gBest = best; gS = bs; }
  }
  return gBest;
}

/** Acceptance rule: the solver order is used iff it verifies AND scores <= the canonical order. */
export function accept(b: Batch, candidate: string[], canonical: VerifyResult, opts: VerifyOptions = {}): { chosen: VerifyResult; fallbackReason: string | null } {
  const cand = verify(b, candidate, opts);
  if (!cand.pass) return { chosen: canonical, fallbackReason: `verifier-rejected:${cand.violations.join(',')}` };
  if (cand.metrics.score > canonical.metrics.score) return { chosen: canonical, fallbackReason: 'solver-lost-to-canonical' };
  return { chosen: cand, fallbackReason: null };
}

export async function run(b: Batch, o: RunOptions = {}): Promise<RunResult> {
  const t0 = performance.now();
  const q = encodeQubo(b);
  const sa = solveSaTabu(q, { seed: b.seed, iterations: o.iterations });
  let perm = sa.perm, energy = sa.energy, solver = 'quantum-inspired-sa-tabu', kind: RunResult['optimized']['solverKind'] = 'quantum-inspired';
  if (o.external) {
    try {
      const bits = await Promise.race([
        o.external.sample(q, o.externalTimeoutMs ?? 2000),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), o.externalTimeoutMs ?? 2000)),
      ]);
      const ep = decodeAssignment(q, bits), ee = permEnergy(q, ep);
      if (ee < energy) { perm = ep; energy = ee; solver = o.external.name; kind = o.external.kind; }
    } catch { /* external hook failure is non-fatal: keep SA result */ }
  }
  const raw = perm.map((i) => q.ids[i]!);
  const tieBreak = o.tieBreak ?? 'sha256';
  // One verifier mode for the whole run: the baseline order, the polish objective
  // and the acceptance check must all agree, or the verdict would be incoherent.
  const vopts: VerifyOptions = { baseline: o.baseline ?? 'canonical', tieBreak };
  const fcfs = verify(b, fcfsOrder(b), vopts);
  const canonical = verify(b, canonicalOrder(b, tieBreak), vopts);
  const candidate = o.polish === false ? raw : polish(b, [raw, fcfs.order], 100, vopts);
  const { chosen, fallbackReason } = accept(b, candidate, canonical, vopts);
  return {
    seed: b.seed, fcfs, canonical,
    optimized: {
      ...chosen, source: fallbackReason ? 'canonical-fallback' : 'solver', fallbackUsed: !!fallbackReason, fallbackReason,
      solver, solverKind: kind, energy, rawSolverOrder: raw, ms: Math.round(performance.now() - t0),
    },
    trace: sa.trace,
    qubo: { n: q.n, variables: q.n * q.n, terms: q.terms.length, penalty: q.penalty },
  };
}
