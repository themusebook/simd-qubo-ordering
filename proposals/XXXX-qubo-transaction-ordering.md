---
simd: 'XXXX'
title: Verifier-Gated Intra-Batch Transaction Ordering via QUBO Solvers
authors:
  - cheshire (Fun Pump / x402.wtf)
category: Standard
type: Core
status: Draft
created: 2026-10-31
feature: (fill in with feature key and github tracking issues once accepted)
---

## Summary

This proposal defines an **optional, leader-local ordering policy** for
transactions that contend on the same writable accounts within a block. A
contention batch is encoded as a Quadratic Unconstrained Binary Optimization
(QUBO) problem; any solver (classical, "quantum-inspired", or an external
quantum sampler) may propose an order; and a **deterministic verifier**
re-simulates the batch, checks hard constraints and computes an integer
objective score. The proposed order is used only if it verifies and scores no
worse than a **canonical fallback order** (priority fee descending, then a
blockhash-seeded hash). Otherwise the canonical order is used.

Because only the leader orders transactions and replay already executes the
block in the order it was produced, this proposal does **not** change replay or
consensus rules in its first phase. It standardises an objective, a verifier
and a fallback so that ordering behaviour is measurable, reproducible and
auditable across clients.

> **Status of the evidence.** A TypeScript off-chain reference prototype
> exists (linked below). It runs on a devnet web API, not inside any validator,
> and uses a classical simulated-annealing + tabu solver. No quantum hardware
> has been used. All numbers in this document come from synthetic demo
> batches.

## Motivation

Within a single slot the leader has full discretion over the order of
conflicting transactions. Current schedulers (e.g. Agave's banking stage
scheduler) order primarily by priority (fee per compute unit) subject to
account locks. For transactions that touch the same AMM pool this leaves room
for in-block sandwiching and back-running, where the ordering itself transfers
value from users to whoever controls or pays for position.

There is no shared, client-agnostic definition of what a "good" order is for a
contention batch, and no way for an observer to check whether the leader's
order was good relative to an obvious baseline. This proposal provides:

1. A precise, integer-valued **objective** (MEV extracted, slippage vs.
   reference, fairness vs. arrival, reverts) that any party can recompute.
2. A **verifier** that turns any candidate order into pass/fail + score.
3. A **canonical fallback** that is total, deterministic and cheap, so the
   policy degrades gracefully when a solver is slow, wrong or malicious.
4. A **solver-agnostic interface** (QUBO), so that classical heuristics today
   and specialised hardware later can compete on equal terms without being
   trusted.

Example from the prototype (synthetic sandwich batch, 3 transactions, seed
`demo-blockhash-1`, one constant-product pool 1,000 SOL / 1,000 MEME, 25 bps):

| Metric                          | FCFS     | Solver (accepted) | Canonical |
|---------------------------------|----------|-------------------|-----------|
| MEV extracted (SOL)             | 2.7736   | 0                 | 0         |
| Avg slippage vs reference       | 5.603%   | 0.014%            | 0.014%    |
| Ordering loss to traders (SOL)  | 2.6617   | 0.0066            | 0.0066    |
| Fairness (Kendall vs arrival)   | 1        | 0.667             | 0.667     |
| Reverted txs                    | 0        | 0                 | 0         |
| Objective score (lower=better)  | 534,465  | 334,023           | 334,023   |

FCFS order `atk-front → victim → atk-back`; optimized order
`atk-front → atk-back → victim`. In this tiny case the canonical order already
neutralises the sandwich (both attacker legs pay the same high fee); a 9-tx
mixed batch in the prototype shows a gap (solver 164,938 vs canonical 453,581 vs
FCFS 361,250). These are illustrations of the mechanism, not evidence of
mainnet impact.

## New Terminology

- **Contention batch**: the set of transactions the leader is about to pack
  that write-lock at least one common account (connected component of the
  write-lock conflict graph), bounded to `MAX_BATCH` transactions.
- **Arrival order**: the order in which the leader's scheduler first
  received the transactions (a local, unverifiable observation).
- **Reference execution** of a transaction: its simulated result when
  executed alone against the pre-batch state.
- **Objective score**: the integer defined in "Objective" below; lower is better.
- **Verifier**: the deterministic function `verify(batch, order) ->
  (pass, violations, metrics, score, state_hash)`.
- **Canonical order**: priority fee descending, ties broken by
  `SHA-256("simd-qubo-ordering/canonical/v1:" || seed || ":" || tx_id)`
  ascending, where `seed` is the parent blockhash and `tx_id` the first
  signature.
- **Solver**: any procedure mapping a QUBO to a bitstring/permutation. It is
  untrusted.
- **Quantum-inspired**: classical heuristics (here: simulated annealing with a
  tabu list) that sample low-energy QUBO states. No quantum hardware.

## Detailed Design

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in [RFC
2119](https://www.ietf.org/rfc/rfc2119.txt) and [RFC
8174](https://www.ietf.org/rfc/rfc8174.txt).

### Overview

```
contention batch ─► encode QUBO ─► solver(s) ─► decode ─► exact polish ─┐
        │                                                              ▼
        └──────────────► canonical order ───────────────► verifier ◄── candidate
                                                             │
                     accept candidate iff pass && score ≤ score(canonical)
```

### QUBO formulation

Let the batch have `n` transactions indexed `i ∈ {0..n-1}` and positions
`p ∈ {0..n-1}`. Binary variables `x_{i,p} = 1` iff transaction `i` is placed at
position `p` (`n²` variables).

The energy is

$$
E(x) = A\sum_i\Big(\sum_p x_{i,p}-1\Big)^2 + A\sum_p\Big(\sum_i x_{i,p}-1\Big)^2
     + \sum_{i\neq j}\; \sum_{p<q} C_{ij}\, x_{i,p}\, x_{j,q}
$$

The first two terms are one-hot penalties forcing a permutation. Expanding with
`x² = x` gives linear terms `-A` per variable, quadratic terms `2A` for every
pair sharing a row or column, and constant `2nA`. The penalty weight MUST
satisfy `A > max_i Σ_j |C_ij|`; the reference uses `A = 1 + 2·max_i Σ_j |C_ij|`.

`C_ij` is the **pairwise precedence cost** of executing `i` before `j`, in the
same units as the objective score:

$$
C_{ij} = \frac{w_f\cdot 10^6}{\binom n2}\,[a_i > a_j]
       + \frac{w_s\cdot 10^6}{n_u}\,\max\!\Big(0,\frac{\text{ref}_j-\text{out}_{j\mid i}}{\text{ref}_j}\Big)
       + \frac{w_m\cdot 10^6}{V}\,\text{gain}_{ij}
       + \frac{w_r\cdot 10^6}{n}\,[\text{revert}_{j\mid i}]
$$

where `a` is arrival rank, `out_{j|i}` is `j`'s output after `i` executes on a
fresh copy of the shared pool, `n_u` the number of non-round-trip swaps, `V`
the batch notional and `gain_{ij}` the round-trip profit when `i`,`j` are the
two legs of one owner's round trip. Pairs on disjoint state have only the
fairness term.

The QUBO is a **pairwise surrogate**: AMM execution is path-dependent beyond
pairs (a sandwich is a three-body effect), so `E` is not the objective. This is
why the verifier, not the solver energy, decides acceptance, and why the
reference applies an exact-objective polish after sampling.

### Solver interface

```
trait OrderingSolver {
    fn name(&self) -> &str;
    fn kind(&self) -> SolverKind;              // Classical | QuantumInspired | Quantum
    /// Return a bitstring over n*n variables (or a permutation) within budget.
    fn sample(&self, q: &Qubo, budget: Budget) -> Result<Vec<u8>, SolverError>;
}
```

- Solvers are untrusted. Any output (including invalid bitstrings) is decoded
  into a permutation by a deterministic greedy repair, then verified.
- A solver failure, timeout or invalid result MUST NOT delay block production;
  the canonical order is used.
- The default solver in the reference is `quantum-inspired-sa-tabu`: restarts
  of simulated annealing over the feasible (permutation) subspace using swap
  and insertion moves with geometric cooling, plus a tabu list over recently
  moved pairs with an aspiration criterion. It is seeded from
  `SHA-256("simd-qubo-ordering/solver/v1:" || seed)` and is fully
  deterministic.
- An OPTIONAL external hook MAY submit the QUBO (`{n, ids, terms, offset}`) to an
  external sampler (e.g. a quantum annealer or QAOA service). Its result is
  used only if its QUBO energy is lower than the local solver's and it then
  passes the same verifier.
- After sampling, an exact-objective polish (best-improvement over single
  insertions using the verifier score) MAY be applied. In the prototype the
  raw sample for the sandwich batch was `atk-front → victim → atk-back` and the
  polish produced `atk-front → atk-back → victim`.

### Deterministic verifier

`verify(batch, order)` MUST be a pure function of the pre-batch state, the
batch and the order, using only integer arithmetic:

1. **Permutation check**: `order` contains every batch transaction exactly once.
2. **Re-simulation**: execute in `order`. For the reference AMM model
   (constant product with fee kept in the pool):
   `fee = ⌊in·feeBps/10⁴⌋`, `in' = in − fee`,
   `out = ⌊R_out·in' / (R_in + in')⌋`. A swap reverts (state unchanged) if
   `out = 0`, `out ≥ R_out`, or `out < minOut`.
   In a validator the re-simulation is the SVM itself (see Implementation).
3. **Constraints** (violations ⇒ `pass = false`):
   - `noNewReverts`: no transaction reverts that would not revert in arrival order;
   - block and per-writable-account CU limits;
   - OPTIONAL `maxDisplacement`: `|pos(i) − arrivalRank(i)| ≤ d`.
4. **Metrics**:
   - *Round-trip owners* `M`: signers that swap both directions on the same pool
     in the batch.
   - *MEV* = Σ over owners in `M` of `max(0, ΔA + value_A(ΔB))`, valued at pre-batch spot.
   - *Slippage* per non-`M` executed swap: `max(0, ref − out)/ref`, floored to
     1e-6, averaged (floored).
   - *Ordering loss* = Σ (ref − out) over non-`M` swaps, valued in A (signed).
   - *Fairness* = `1 − ⌊10⁶·D/ C(n,2)⌋/10⁶`, `D` = discordant pairs vs.
     arrival (a normalised Kendall-tau distance).
   - *Reverts* = number of reverted transactions.
5. **Objective** (all integer, units of 10⁻⁶):

$$
S = w_m\Big\lfloor\frac{10^6\,\text{MEV}}{V}\Big\rfloor + w_s\,\text{slip}_{e6}
  + w_f\Big\lfloor\frac{10^6 D}{\binom n2}\Big\rfloor + w_r\Big\lfloor\frac{10^6 R}{n}\Big\rfloor
$$

   with `V` = batch notional in A at pre-batch spot and default weights
   `w_m=10, w_s=5, w_f=1, w_r=5`.
6. **State hash**: SHA-256 over a domain tag, seed, order, final reserves and
   per-transaction outcomes, so two implementations can compare results byte
   for byte.

### Canonical fallback

The canonical order MUST be computed as: sort by priority fee (lamports per
CU in a validator; total fee in the prototype) descending, then by
`SHA-256(domain || seed || ":" || first_signature)` ascending. It is total,
O(n log n), and requires no solver. The decision rule is:

```
candidate ← polish(decode(solver(qubo)))
if verify(candidate).pass and score(candidate) ≤ score(canonical): use candidate
else: use canonical   (fallbackReason = verifier-rejected | solver-lost-to-canonical | solver-error)
```

(The live devnet prototype's tie-break hash differs; see "Open questions" in
the repository README.)

### Determinism and consensus considerations

- **Phase 1 (this SIMD): leader-local policy, no consensus change.** Replay
  executes entries in the order the leader produced them, so other validators
  need not run the solver. The verifier and objective are standardised so
  that anyone can audit a produced block after the fact.
- The solver MAY be nondeterministic across clients (different hardware,
  timeouts). Only the verifier and canonical order MUST be bit-exact. No
  floating-point arithmetic is permitted in the verifier.
- **Phase 2 (out of scope, would need its own SIMD):** making the canonical
  order or a verifier bound a validity rule (e.g. "a block is invalid if a
  contention batch scores worse than canonical") would be a consensus change,
  require all clients (Agave, Firedancer, …) to implement identical
  simulation for all programs, and is likely incompatible with asynchronous
  execution and current block-packing throughput. This document does not
  propose it.

### Compute budget

- Batches are capped (RECOMMENDED `MAX_BATCH = 16`, i.e. 256 QUBO variables)
  and only formed for components with ≥ 3 conflicting transactions.
- Each verifier call is one simulation of the batch; polish costs
  `O(k·n²)` verifier calls. The leader MUST bound total wall time per batch
  (RECOMMENDED ≤ 2 ms per batch, ≤ 5% of slot time in aggregate) and fall back
  to canonical when the budget is exhausted.
- In the prototype a 3-tx batch solves in ~1–12 ms and a 9-tx batch in ~20 ms
  in TypeScript on a commodity machine, not optimised. A production
  implementation would need to be measured in Rust inside the scheduler.

### Implementation: where it hooks into Agave

Agave's banking stage receives transactions into a `TransactionStateContainer`
and a central scheduler (`Scheduler` trait in
`core/src/banking_stage/transaction_scheduler/scheduler.rs`, currently
e.g. `GreedyScheduler` in `greedy_scheduler.rs`) selects batches that
are sent to `ConsumeWorker`s, which execute them through `solana-svm`'s
`TransactionBatchProcessor::load_and_execute_sanitized_transactions`.

The policy would be implemented as an alternative `Scheduler` (or a stage
inside an existing one) that:

1. pops the top-priority window from the container,
2. builds the write-lock conflict graph and extracts contention components,
3. for each component, runs encode → solve → polish → verify against a forked
   simulation (via `solana-svm` with a read-only account callback over the
   working bank),
4. emits the accepted order as a sequential chain of single-transaction
   `ConsumeWork` items (or a sequential batch) so that execution order equals
   verified order.

See `docs/integration.md` for details and links.

### Edge Cases

- `n ≤ 2`: the solver is skipped; the verifier still compares FCFS-like and
  canonical orders.
- All transactions on disjoint state: only the fairness term is non-zero; the
  arrival order is optimal and the batch should not be formed at all.
- Equal fees and colliding signature prefixes: tie-break hash is total
  because signatures are unique.
- Transactions that revert in every order are not "new" reverts.
- Pool with zero reserves or swaps whose output would drain a reserve: revert.
- Non-AMM programs: the objective needs a reference model; the verifier falls
  back to the SVM result and only the revert and fairness terms are defined.

### Validator Components Affected

| Validator Component             | Impact                                                       |
|---------------------------------|--------------------------------------------------------------|
| Transaction Execution (Runtime) | None (execution semantics unchanged)                         |
| Virtual Machine                 | None                                                         |
| Block Packing                   | New optional ordering policy inside the leader's scheduler   |
| Consensus                       | None in phase 1                                              |
| Gossip                          | None                                                         |
| Turbine                         | None                                                         |
| Snapshots                       | None                                                         |
| On-Chain Core BPF Programs      | None                                                         |
| Other (please describe)         | Optional external solver hook; metrics/telemetry for audits  |

## Alternatives Considered

- **Status quo (priority-fee greedy packing).** Simple and fast; does not
  address intra-batch value transfer.
- **Canonical order only (no solver).** Cheap and deterministic, and in the
  3-tx sandwich already as good as the solver. It loses on mixed batches in the
  prototype (453,581 vs 164,938). This SIMD makes canonical the floor, so a
  client can ship canonical-only and still conform.
- **Exact search (brute force / branch-and-bound / MILP).** Exact for small
  `n` (9! ≈ 363k orders) but exponential; QUBO + heuristic gives anytime
  behaviour with a verified floor.
- **Encrypted mempools / threshold decryption, batch auctions, frequent batch
  clearing at the application layer** (e.g. intents, on-chain batch auctions).
  Address MEV at a different layer; complementary.
- **Application-level protections** (tight `minOut`, private RPCs, MEV-aware
  routers). Work today; rely on user configuration.
- **Multiple concurrent proposers / leader rotation changes.** Larger protocol
  changes with broader goals.

## Impact

- **Dapp developers / users:** in batches where the policy runs, sandwich-style
  orderings score worse than canonical and are not chosen; users see less
  slippage relative to reference execution. No API changes.
- **Validators:** opt-in CPU cost in the scheduler; possible loss of private
  MEV revenue for operators who would otherwise extract it. No change to
  rewards logic.
- **Core contributors:** a new scheduler implementation and a shared verifier
  test vector suite. The reference prototype provides vectors.

## Security Considerations

- **Solver manipulation.** Solvers (especially external ones) are untrusted.
  Safety comes from the verifier and the `≤ canonical` acceptance rule: a
  malicious solver can at worst waste its budget. External hooks MUST be
  time-boxed and MUST NOT receive private key material; the QUBO leaks the
  contention batch contents to the external operator, which is itself an MEV
  risk, so external hooks SHOULD be disabled by default.
- **Objective gaming.** The round-trip-owner heuristic is evadable by splitting
  legs across signers; the slippage and loss terms still penalise harmful
  orderings, but weights and definitions need adversarial review. Arrival
  order is leader-observed and can be spoofed by latency games.
- **Determinism.** Any divergence between client verifiers (rounding, overflow,
  hash domain) would make audits unreliable. The verifier uses integer math
  with explicit floors; conformance vectors MUST include rounding edge cases.
- **DoS.** Attackers can craft many conflicting transactions to maximise
  solver cost. Mitigations: `MAX_BATCH`, per-batch and per-slot time budgets,
  skipping batches below a contention threshold, and falling back to canonical
  when over budget.
- **Leader discretion.** In phase 1 nothing forces a leader to run the policy
  or to report honestly; a leader can still insert its own transactions or
  ignore the result. The benefit is measurability: any observer can recompute
  `verify()` on the produced block and on canonical and publish the gap.
- **Seed grinding.** The seed is the parent blockhash, which the leader does not
  control for its own slot; transaction signatures are user-controlled but only
  affect equal-fee tie breaks.

## Drawbacks

- Adds complexity and latency to the most performance-sensitive part of the
  validator for gains that have only been shown on synthetic batches.
- The objective encodes value judgements (fairness vs. slippage vs. MEV
  weights) that the community may not agree on.
- The AMM model is specific; generalising the objective beyond
  constant-product pools requires per-program reference models or full SVM
  simulation, which is expensive.
- "Quantum" framing may suggest capabilities that do not exist; the default and
  only tested solver is classical.

## Backwards Compatibility

Phase 1 introduces no breaking changes: no feature gate, no change to
transaction format, execution or replay. Validators that do not implement it
are unaffected. Any later move to a validity rule would require a feature gate
and a separate SIMD.

## Conformance

The reference repository ships JSON test vectors (`fixtures/`) captured from
the devnet prototype and a test suite that checks, for each vector, the
verifier metrics, score and canonical order. Client implementations SHOULD
reproduce `verify()` outputs and state hashes on these vectors byte for byte.

## References

- Reference prototype (TypeScript, Apache-2.0): this repository (to be published).
- Live demo: https://devnet.x402.wtf/simd420 (off-chain, devnet).
- Agave banking stage scheduler:
  https://github.com/anza-xyz/agave/tree/master/core/src/banking_stage/transaction_scheduler
- SVM spec: https://github.com/anza-xyz/agave/blob/master/svm/doc/spec.md
- Anza, "Anza's New SVM API": https://www.anza.xyz/blog/anzas-new-svm-api
