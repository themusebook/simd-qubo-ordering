import type { Metrics, VerifyResult } from './types.ts';
import type { RunResult } from './pipeline.ts';

/**
 * Stable JSON serialization of verifier / pipeline results, used by the
 * conformance vectors (fixtures/conformance/*.json) and the browser client.
 * Bigints become decimal strings; floats are the exact doubles the verifier
 * computes, so a deep-equal against a vector is a byte-for-byte check of every
 * metric, the score, the orders, the verdict and the state hash.
 */
export interface SerializedMetrics {
  mevExtractedLamports: string;
  mevExtractedSol: number;
  avgSlippagePct: number;
  orderingLossLamports: string;
  orderingLossSol: number;
  fairness: number;
  reverts: number;
  revertedIds: string[];
  totalCu: number;
  score: string;
}

export interface SerializedVerify extends SerializedMetrics {
  order: string[];
  pass: boolean;
  violations: string[];
  stateHash: string;
}

export function serializeMetrics(m: Metrics): SerializedMetrics {
  return {
    mevExtractedLamports: m.mevExtractedLamports.toString(),
    mevExtractedSol: m.mevExtractedSol,
    avgSlippagePct: m.avgSlippagePct,
    orderingLossLamports: m.orderingLossLamports.toString(),
    orderingLossSol: m.orderingLossSol,
    fairness: m.fairness,
    reverts: m.reverts,
    revertedIds: [...m.revertedIds],
    totalCu: m.totalCu,
    score: m.score.toString(),
  };
}

export function serializeVerify(v: VerifyResult): SerializedVerify {
  return { order: [...v.order], pass: v.pass, violations: [...v.violations], stateHash: v.stateHash, ...serializeMetrics(v.metrics) };
}

export interface SerializedRun {
  seed: string;
  fcfs: SerializedVerify;
  canonical: SerializedVerify;
  optimized: SerializedVerify & {
    source: 'solver' | 'canonical-fallback';
    fallbackUsed: boolean;
    fallbackReason: string | null;
    solver: string;
    solverKind: string;
    energy: number;
    rawSolverOrder: string[];
  };
  qubo: RunResult['qubo'];
}

/** Serialize a pipeline run. Timing (`ms`) and the solver trace are excluded: they are not part of the verdict. */
export function serializeRun(r: RunResult): SerializedRun {
  const { source, fallbackUsed, fallbackReason, solver, solverKind, energy, rawSolverOrder, ...chosen } = r.optimized;
  return {
    seed: r.seed,
    fcfs: serializeVerify(r.fcfs),
    canonical: serializeVerify(r.canonical),
    optimized: { ...serializeVerify(chosen), source, fallbackUsed, fallbackReason, solver, solverKind, energy, rawSolverOrder: [...rawSolverOrder] },
    qubo: r.qubo,
  };
}
