// The browser bundle aliases node:crypto to browser/crypto-shim.ts (pure TS,
// synchronous — WebCrypto is async-only). These tests pin the shim to
// node:crypto on the exact input shapes the client hashes, plus standard
// known-answer vectors, so the bundled client cannot silently diverge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHash as shimCreateHash } from '../browser/crypto-shim.ts';

const INPUTS = [
  '',
  'abc',
  'simd-qubo-ordering/canonical/v1:demo-blockhash-1:atk-front',
  'simd-qubo-ordering/solver/v1:demo-blockhash-1',
  'simd420:demo-blockhash-1:victim',
  'simd-qubo-ordering/v1|seed|a,b,c|pool:1:2;',
  'x'.repeat(200), // multi-block
  'ünïcode ✓ domain tag',
];

for (const algo of ['sha256', 'sha1'] as const) {
  test(`crypto-shim ${algo} matches node:crypto (hex + chunked updates)`, () => {
    for (const s of INPUTS) {
      const expected = createHash(algo).update(s).digest('hex');
      assert.equal(shimCreateHash(algo).update(s).digest('hex'), expected);
      const h = shimCreateHash(algo); // chunked updates must equal one-shot
      for (const ch of s) h.update(ch);
      assert.equal(h.digest('hex'), expected);
    }
  });
}

test('crypto-shim known-answer vectors', () => {
  assert.equal(shimCreateHash('sha256').update('abc').digest('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(shimCreateHash('sha1').update('abc').digest('hex'),
    'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('crypto-shim digest() buffer supports readUInt32LE like node (rng seeding)', () => {
  const label = 'simd-qubo-ordering/solver/v1:demo-blockhash-1';
  const nodeBuf = createHash('sha256').update(label).digest();
  const shimBuf = shimCreateHash('sha256').update(label).digest() as unknown as { readUInt32LE(n: number): number };
  for (const off of [0, 4, 8, 12]) assert.equal(shimBuf.readUInt32LE(off), nodeBuf.readUInt32LE(off));
});
