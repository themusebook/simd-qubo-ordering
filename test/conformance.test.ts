// SPEC MODE conformance: fixtures/conformance/*.json are vectors computed
// entirely under the amended spec definitions (SHA-256 canonical tie-break,
// canonical noNewReverts baseline, spec state hash — see the vectors' meta).
// These tests assert the client reproduces them BYTE FOR BYTE: orders, pass,
// violations, every metric, scores, the accept/fallback verdict and state hashes.
// (For the captured live-prototype vectors, see test/live-parity.test.ts — legacy mode.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBatch, run, verify, canonicalOrder, fcfsOrder, serializeRun } from '../src/index.ts';

for (const name of ['sandwich', 'mixed']) {
  const vector = JSON.parse(readFileSync(new URL(`../fixtures/conformance/${name}.json`, import.meta.url), 'utf8'));
  const b = parseBatch(vector.batch);

  test(`SPEC conformance ${name}: full pipeline reproduces the vector byte for byte`, async () => {
    const r = serializeRun(await run(b)); // spec mode defaults
    assert.deepEqual(r, vector.expected);
  });

  test(`SPEC conformance ${name}: canonical + FCFS orders and per-order verify() match the vector`, () => {
    assert.deepEqual(canonicalOrder(b), vector.expected.canonical.order); // default tie-break = spec sha256
    assert.deepEqual(fcfsOrder(b), vector.expected.fcfs.order);
    for (const k of ['fcfs', 'canonical', 'optimized'] as const) {
      const v = verify(b, vector.expected[k].order); // default = spec mode
      assert.equal(v.pass, vector.expected[k].pass);
      assert.deepEqual(v.violations, vector.expected[k].violations);
      assert.equal(v.stateHash, vector.expected[k].stateHash);
      assert.equal(v.metrics.score.toString(), vector.expected[k].score);
    }
  });
}
