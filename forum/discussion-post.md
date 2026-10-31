<!-- DRAFT: not posted. Target: https://forum.solana.com/c/simd/5 (category "SIMD").
     Also cross-post as an idea at
     https://github.com/solana-foundation/solana-improvement-documents/discussions/categories/ideas -->

**Title:** SIMD Idea: verifier-gated transaction ordering within contention batches (QUBO solver + canonical fallback)

Hi all,

I'd like feedback on an early idea before opening a SIMD PR. A draft and an
off-chain reference prototype are ready.

**The problem.** Inside a slot, the leader decides the order of transactions
that hit the same writable accounts (for example one AMM pool). There is no
shared definition of a "good" order for such a batch, and no easy way for
anyone to check a produced block against a baseline. In-block sandwiches
exist because of that gap.

**The idea (phase 1, leader-local, no consensus change):**

1. Take a contention batch (a connected component of the write-lock graph, capped at about 16 txs).
2. Encode ordering as a QUBO (permutation one-hot plus pairwise precedence costs).
3. Any untrusted solver proposes an order. The default is classical simulated annealing plus tabu ("quantum-inspired"). An external sampler hook is optional and off by default.
4. A **deterministic, integer-only verifier** re-simulates the batch, checks constraints (no new reverts, CU limits, optional max displacement), and computes an objective: MEV extracted, slippage vs. reference execution, fairness (Kendall distance to arrival), and reverts.
5. The candidate is used **only if it passes and scores no worse than a canonical order** (fee desc, then SHA-256(blockhash, signature)). Otherwise the canonical order is used.

Replay is unchanged, since the block already fixes the order. The point is to
standardise the objective, the verifier and the fallback, so ordering quality
is measurable and auditable across clients.

**Prototype numbers (synthetic, 3-tx sandwich, seed `demo-blockhash-1`):**

| | FCFS | solver (accepted) | canonical |
|-|-|-|-|
| MEV (SOL) | 2.7736 | 0 | 0 |
| avg slippage | 5.603% | 0.014% | 0.014% |
| loss to traders (SOL) | 2.6617 | 0.0066 | 0.0066 |
| Kendall vs arrival | 1 | 0.667 | 0.667 |
| objective | 534,465 | 334,023 | 334,023 |

On a 9-tx mixed batch: FCFS 361,250, canonical 453,581, solver 164,938.
These are toy batches on a modeled constant-product pool. They show the
mechanism, not mainnet impact.

**To be explicit:** this runs off-chain on a devnet web API, not in any
validator. No quantum hardware has been used.

**Questions I'd especially like input on:**

- Is a standardised objective and verifier useful even as a leader-local policy, for auditing and telemetry?
- Which objective terms and weights are defensible, and how easy is the round-trip-owner MEV heuristic to game?
- Is a 1–2 ms per-batch budget in the Agave scheduler (or Firedancer pack) realistic, or should this stay an analysis tool?
- Should the canonical order alone (no solver) be the first step?

Links:

- Draft SIMD: (link to PR once opened)
- Reference implementation (TypeScript, Apache-2.0) with tests and an in-browser demo: (repo link)
- Live demo: https://devnet.x402.wtf/simd420

Thanks!
