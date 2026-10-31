import type { Qubo } from './qubo.ts';
import { permEnergy } from './qubo.ts';
import { rng } from './rng.ts';

export interface SolverResult { perm: number[]; energy: number; trace: Array<{ iter: number; energy: number; best: number; temp: number }>; iterations: number }

export interface SolverOptions { seed: string; iterations?: number; restarts?: number; tabuTenure?: number; traceEvery?: number }

/**
 * Quantum-inspired simulated annealing + tabu over the permutation subspace of the QUBO.
 * Moves stay one-hot feasible (swap / insert), so the penalty terms are always zero and the
 * QUBO energy equals permEnergy(). Deterministic given (qubo, seed, options).
 */
export function solveSaTabu(q: Qubo, o: SolverOptions): SolverResult {
  const n = q.n;
  const iters = o.iterations ?? Math.max(200, 400 * n);
  const restarts = o.restarts ?? 4;
  const tenure = o.tabuTenure ?? Math.max(2, Math.floor(n / 2));
  const every = o.traceEvery ?? Math.max(1, Math.floor(iters / 100));
  const rand = rng(`simd-qubo-ordering/solver/v1:${o.seed}`);
  const trace: SolverResult['trace'] = [];
  let gBest = [...Array(n).keys()], gE = permEnergy(q, gBest);
  if (n < 2) return { perm: gBest, energy: gE, trace: [{ iter: 0, energy: gE, best: gE, temp: 0 }], iterations: 0 };
  let scale = 0;
  for (const r of q.C) for (const c of r) scale = Math.max(scale, Math.abs(c));
  const T0 = Math.max(1, scale), T1 = T0 * 1e-4;
  let it = 0;
  for (let r = 0; r < restarts; r++) {
    const cur = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cur[i], cur[j]] = [cur[j]!, cur[i]!]; }
    let e = permEnergy(q, cur), best = [...cur], bE = e;
    const tabu = new Map<string, number>();
    for (let k = 0; k < iters; k++, it++) {
      const T = T0 * Math.pow(T1 / T0, k / iters);
      const a = Math.floor(rand() * n); let c = Math.floor(rand() * (n - 1)); if (c >= a) c++;
      const insert = rand() < 0.5;
      const cand = [...cur];
      if (insert) { const [m] = cand.splice(a, 1); cand.splice(c, 0, m!); } else { [cand[a], cand[c]] = [cand[c]!, cand[a]!]; }
      const key = `${Math.min(cur[a]!, cur[c]!)}-${Math.max(cur[a]!, cur[c]!)}`;
      const ce = permEnergy(q, cand), d = ce - e;
      const isTabu = (tabu.get(key) ?? -1) > k && ce >= bE; // aspiration: tabu overridden if new best
      if (!isTabu && (d <= 0 || rand() < Math.exp(-d / T))) {
        cur.splice(0, n, ...cand); e = ce; tabu.set(key, k + tenure);
        if (e < bE) { bE = e; best = [...cur]; }
      }
      if (k % every === 0) trace.push({ iter: it, energy: e, best: Math.min(bE, gE), temp: T });
    }
    if (bE < gE) { gE = bE; gBest = best; }
  }
  trace.push({ iter: it, energy: gE, best: gE, temp: T1 });
  return { perm: gBest, energy: gE, trace, iterations: it };
}
