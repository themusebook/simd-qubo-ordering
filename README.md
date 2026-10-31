# simd-qubo-ordering

Reference prototype for a **DRAFT** SIMD: *verifier-gated intra-batch
transaction ordering via QUBO solvers, with a canonical fallback.*

> Off-chain prototype. It does not run inside any Solana validator. The
> default solver is classical "quantum-inspired" simulated annealing + tabu,
> and no quantum hardware is used. All numbers come from synthetic batches.

A contention batch is encoded as a QUBO. A solver proposes an order. A
deterministic integer-only verifier re-simulates a constant-product AMM,
checks constraints and scores the order. If the solver fails or loses, the
canonical order (fee desc, then seeded hash) is used.

- Proposal: [`proposals/XXXX-qubo-transaction-ordering.md`](proposals/XXXX-qubo-transaction-ordering.md)
- Agave / SVM integration notes: [`docs/integration.md`](docs/integration.md)
- Forum post draft: [`forum/discussion-post.md`](forum/discussion-post.md)
- Demo (single static file, no build): [`demo/index.html`](demo/index.html)

![demo](demo/screenshot.png)

## Quick start

Requires Node ≥ 23.6, which runs `.ts` files directly. There are no runtime
dependencies; TypeScript is used only for `npm run typecheck`.

```sh
npm install          # dev toolchain only (typescript, @types/node)
npm test             # node:test, 20 tests
npm run typecheck
node src/cli.ts fixtures/sandwich.json
node src/cli.ts fixtures/mixed.json --tiebreak sha1-compat --json
open demo/index.html # or any static server; add ?static to disable animations
```

Sandwich output:

```
                                            FCFS       optimized       canonical
MEV extracted (SOL)                       2.7736          0.0000          0.0000
Avg slippage vs reference (%)             5.6029          0.0138          0.0138
Ordering loss to traders (SOL)            2.6617          0.0066          0.0066
Fairness (Kendall vs arrival)              1.000           0.667           0.667
Objective score (lower=better)           534,465         334,023         334,023
FCFS:      atk-front → victim → atk-back
Optimized: atk-front → atk-back → victim  (solver order accepted)
```

## Layout

| Path | What |
|------|------|
| `src/amm.ts` | constant-product quote (`fee = ⌊in·bps/1e4⌋`, fee stays in pool) |
| `src/verifier.ts` | simulation, constraints, metrics, integer objective, state hash |
| `src/canonical.ts` | canonical fallback order + FCFS |
| `src/qubo.ts` | permutation QUBO encode, energy, decode/repair |
| `src/solver.ts` | `quantum-inspired-sa-tabu` (deterministic, seeded) |
| `src/pipeline.ts` | encode → solve → optional external hook → polish → verify → accept/fallback |
| `src/cli.ts` | CLI |
| `fixtures/*.json` | verbatim responses from the live devnet API (test vectors) |
| `test/` | parity with live API + sandwich example + QUBO/fallback properties |
| `demo/index.html` | self-contained in-browser demo (engine ported inline) |

## Live API (source of the fixtures)

The page https://devnet.x402.wtf/simd420 is a client-rendered SPA. Its lazy chunk
`assets/Simd420-*.js` fetches the following from `https://clawd-pump-api-devnet.onrender.com`:

- `GET /api/simd420/demo?scenario=sandwich`
- `GET /api/simd420/demo?scenario=mixed`
- `GET /api/simd420/devnet` (real devnet trade sizes/directions; reserves modeled)

Response shape: `{ok, scenario, source, slot, seed, txCount, pools[], txs[], spec, fcfs, optimized, canonical, disclaimer}`.
`api.x402.wtf` returns 404 for these paths.

## Parity with the live prototype

The prototype's server source was not recoverable, so this repo is a clean-room
reimplementation fitted to its outputs. For all three captured fixtures, the
verifier reproduces the live FCFS, optimized and canonical metrics and scores
exactly (MEV lamports, slippage, loss, fairness, CU, score). The solver's
scores are equal to or better than the live ones. On `mixed`, the order differs
from the live one but the score is the same (164,938).

The live canonical tie-break hash is not SHA-256. `sha1("simd420:"+seed+":"+id)`
reproduces every captured canonical order, but several other hashes do too,
so the exact function is unknown. That variant is available as
`--tiebreak sha1-compat`. The proposal and the default use SHA-256 with a
domain tag. State hashes are this repo's own definition and do not match the
live ones.

## License

Apache-2.0
