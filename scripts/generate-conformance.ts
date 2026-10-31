/**
 * Generate the SPEC conformance vectors in fixtures/conformance/*.json.
 *
 * Unlike fixtures/*.json (captured from the live prototype, whose tie-break and
 * revert baseline predate the spec), these vectors are computed entirely under
 * the definitions in proposals/XXXX-qubo-transaction-ordering.md as amended:
 *   - canonical order: priority fee desc, SHA-256("simd-qubo-ordering/canonical/v1:" || seed || ":" || tx_id) asc
 *   - noNewReverts baseline: the canonical order
 *   - state hash: the byte layout documented in src/verifier.ts (spec step 6)
 * test/conformance.test.ts re-runs the client in spec mode and asserts the
 * vectors reproduce byte for byte. Regenerate with: npm run gen:conformance
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseBatch } from '../src/fixtures.ts';
import { run } from '../src/pipeline.ts';
import { serializeRun } from '../src/serialize.ts';

mkdirSync(new URL('../fixtures/conformance', import.meta.url), { recursive: true });

for (const name of ['sandwich', 'mixed']) {
  const batchJson = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
  const batch = parseBatch(batchJson);
  const result = serializeRun(await run(batch)); // spec mode defaults
  const vector = {
    meta: {
      kind: 'spec-conformance-vector',
      scenario: name,
      mode: 'spec',
      tieBreak: 'sha256("simd-qubo-ordering/canonical/v1:" || seed || ":" || tx_id)',
      revertBaseline: 'canonical',
      stateHash: 'sha256 over "simd-qubo-ordering/v1|" seed "|" order "|" per-pool reserves "|" per-tx outcomes (see src/verifier.ts)',
      generatedBy: 'scripts/generate-conformance.ts',
      note: 'Computed from the fixture batch under the amended spec definitions. NOT captured from the live prototype (see fixtures/*.json + test/live-parity.test.ts for the legacy vectors).',
    },
    batch: batchJson,
    expected: result,
  };
  const path = new URL(`../fixtures/conformance/${name}.json`, import.meta.url);
  writeFileSync(path, JSON.stringify(vector, null, 2) + '\n');
  console.log(`${name}: fcfs=${result.fcfs.score} canonical=${result.canonical.score} optimized=${result.optimized.score} (${result.optimized.source}${result.optimized.fallbackReason ? ', ' + result.optimized.fallbackReason : ''}) stateHash=${result.optimized.stateHash}`);
}
