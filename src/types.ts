// Core data model for the SIMD-XXXX reference prototype.
// All token amounts are integer base units (bigint). "A" is the quote side (SOL lamports).

export type Dir = 'AtoB' | 'BtoA';

export interface Pool {
  id: string;
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number;
}

export interface Swap {
  pool: string;
  dir: Dir;
  amountIn: bigint;
  minOut: bigint;
}

export interface Tx {
  id: string;
  owner: string;
  arrival: number;
  feeLamports: number;
  swap: Swap | null; // null = non-AMM tx (e.g. transfer)
}

export interface Weights {
  mev: number;
  slippage: number;
  fairness: number;
  revert: number;
}

export interface Spec {
  weights: Weights;
  blockCuLimit: number;
  accountCuLimit: number;
  maxDisplacement: number | null;
  noNewReverts: boolean;
}

export interface Batch {
  slot: number;
  seed: string; // blockhash (or demo seed) used for every seeded decision
  pools: Pool[];
  txs: Tx[];
  spec: Spec;
}

export interface Metrics {
  mevExtractedLamports: bigint;
  mevExtractedSol: number;
  avgSlippagePct: number; // floored to 4 dp
  orderingLossLamports: bigint;
  orderingLossSol: number;
  fairness: number; // 1 - floor6(discordant/pairs) vs arrival order
  reverts: number;
  revertedIds: string[];
  totalCu: number;
  score: bigint; // lower is better, integer, deterministic
}

export interface VerifyResult {
  order: string[];
  pass: boolean;
  violations: string[];
  metrics: Metrics;
  stateHash: string;
}

export const DEFAULT_SPEC: Spec = {
  weights: { mev: 10, slippage: 5, fairness: 1, revert: 5 },
  blockCuLimit: 48_000_000,
  accountCuLimit: 12_000_000,
  maxDisplacement: null,
  noNewReverts: true,
};

export const CU_SWAP = 120_000;
export const CU_TRANSFER = 450;
