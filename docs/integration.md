# Integrating verifier-gated ordering with Agave and the SVM

Status: design notes for a DRAFT SIMD. Nothing here has been implemented in
Agave; the only running code is the off-chain TypeScript prototype in this repo.

## What "SVM kit" refers to

There is no Anza product literally named "SVM kit". In context it most likely
means one of these:

| Name | What it is | Link |
|------|------------|------|
| `solana-svm` crate | Anza's standalone SVM: transaction loading + execution decoupled from the validator. Central type `TransactionBatchProcessor`, entry point `load_and_execute_sanitized_transactions`, account access via the `TransactionProcessingCallback` trait. Apache-2.0. | https://crates.io/crates/solana-svm · https://docs.rs/solana-svm |
| SVM specification | The spec for the standalone SVM API and its internals | https://github.com/anza-xyz/agave/blob/master/svm/doc/spec.md |
| Anza blog post | "Anza's New SVM API": motivation and API walkthrough | https://www.anza.xyz/blog/anzas-new-svm-api |
| SVM sub-crates in Agave | `svm`, `svm-callback`, `svm-feature-set`, `svm-conformance`, `svm-log-collector`, `svm-measure`, `svm-timings`, `svm-type-overrides` | https://github.com/anza-xyz/agave/tree/master/svm |
| `agave-scheduling-utils` | "Common utilities for building Agave scheduler implementations" | https://github.com/anza-xyz/agave/tree/master/scheduling-utils · https://docs.rs/agave-scheduling-utils |
| `@solana/kit` | Anza's JS/TS client SDK (successor to web3.js). Useful for building the off-chain prototype against real RPC, not for the scheduler. | https://github.com/anza-xyz/kit |

**Open question for the user:** confirm which of these "SVM kit" means. These
notes assume `solana-svm` for simulation and the Agave banking-stage scheduler
for ordering.

## Where ordering happens in Agave today

`core/src/banking_stage/` (https://github.com/anza-xyz/agave/tree/master/core/src/banking_stage):

- `transaction_scheduler/receive_and_buffer.rs`: ingests packets into a
  `TransactionStateContainer` (`transaction_state_container.rs`) keyed by
  priority (`transaction_priority_id.rs`).
- `transaction_scheduler/scheduler.rs`: `pub(crate) trait Scheduler<Tx>` with
  `schedule(...)`, `receive_completed(...)`, `has_in_flight_transactions()`.
- `transaction_scheduler/greedy_scheduler.rs`: the current implementation of that trait.
- `transaction_scheduler/scheduler_controller.rs`: drives the loop and
  `decision_maker.rs` decides whether this node is (about to be) leader.
- `consume_worker.rs` / `consumer.rs`: execute scheduled batches against the
  working bank, which calls into `solana-svm`.
- `qos_service.rs`: CU accounting and block cost limits.

Link to the scheduler directory:
https://github.com/anza-xyz/agave/tree/master/core/src/banking_stage/transaction_scheduler

## Proposed hook

```
receive_and_buffer ──► TransactionStateContainer
                             │ (top-priority window, e.g. 256 txs)
                             ▼
                 ┌──── QuboOrderingScheduler (new impl of Scheduler) ────┐
                 │ 1. build write-lock conflict graph over the window     │
                 │ 2. components with >= 3 txs and <= MAX_BATCH          │
                 │ 3. encode QUBO → SA+tabu (time-boxed) → polish        │
                 │ 4. verify(candidate), verify(canonical) via forked    │
                 │    simulation (solana-svm, read-only callback)        │
                 │ 5. accept iff pass && score <= canonical              │
                 └───────────────────────┬───────────────────────────────┘
                                         ▼
           ConsumeWork batches in accepted order (sequential per component)
                                         ▼
                consume_worker → bank → solana-svm (unchanged)
```

Notes:

1. **Execution order must equal verified order.** Agave executes a batch's
   non-conflicting transactions in parallel, but conflicting ones are
   serialised by account locks. A component's accepted order must be sent as
   a strictly sequential chain (e.g. one tx per `ConsumeWork`, gated on
   completion, or a batch that the consumer guarantees to execute in order).
2. **Simulation.** The verifier needs the post-state of a hypothetical order.
   With `solana-svm`, implement `TransactionProcessingCallback` over a
   copy-on-write overlay of the working bank's accounts and call
   `load_and_execute_sanitized_transactions` on the ordered sequence, applying
   each result to the overlay. For pure constant-product AMMs a native model
   (as in this repo) is much cheaper and can be used as a pre-filter; the final
   check should use the SVM so non-AMM effects are captured.
3. **Budget.** Per-component deadline (e.g. 1–2 ms); on expiry use canonical.
   The solver runs off the hot path in a dedicated thread pool; consume
   workers keep executing non-contended work meanwhile.
4. **Priority.** Canonical order is fee-desc, consistent with the existing
   priority model, so falling back never violates fee expectations more than
   today.
5. **Metrics.** Emit per-slot counts of components, accepted/fallback, score
   gap vs canonical and FCFS, solver time, in `scheduler_metrics.rs` style.
6. **External hook.** Disabled by default; if enabled, the QUBO is sent with a
   hard timeout and the result treated like any other untrusted candidate.

## Steps to a real Agave PR (after the SIMD discussion)

1. Port `verifier.ts` + `canonical.ts` to a Rust crate (`no_std`-friendly,
   integer only), and check it against `fixtures/*.json`.
2. Prototype `QuboOrderingScheduler` behind a CLI flag (no feature gate needed
   for phase 1 since it is leader-local policy), using
   `agave-scheduling-utils`.
3. Benchmark with `banking-bench` and local-cluster replays of recorded
   mainnet traffic; report throughput impact and score deltas.
4. Coordinate with other clients (Firedancer's pack) on the shared verifier
   and test vectors.

## Firedancer note

Firedancer's packing is in its `pack` tile
(https://github.com/firedancer-io/firedancer/tree/main/src/disco/pack). A
conformant canonical order + verifier would let both clients report
comparable ordering metrics.
