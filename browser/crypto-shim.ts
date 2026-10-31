/**
 * Minimal pure-TypeScript stand-in for the slice of `node:crypto` the client
 * uses (createHash('sha256'|'sha1').update(string).digest('hex'|buffer with
 * readUInt32LE)). It exists so the REAL src/ modules can be bundled for the
 * browser with esbuild's --alias:node:crypto — WebCrypto is async-only and the
 * verifier is synchronous. Correctness is pinned against node:crypto by
 * test/crypto-shim.test.ts. NOT a general crypto library: messages here are
 * short domain-tagged strings, buffered whole and hashed at digest() time.
 */

export class DigestBytes extends Uint8Array {
  readUInt32LE(offset = 0): number {
    return (this[offset]! | (this[offset + 1]! << 8) | (this[offset + 2]! << 16) | (this[offset + 3]! << 24)) >>> 0;
  }
}

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function pad(msg: Uint8Array): Uint8Array {
  const bitLen = msg.length * 8;
  const total = Math.ceil((msg.length + 9) / 64) * 64;
  const out = new Uint8Array(total);
  out.set(msg);
  out[msg.length] = 0x80;
  const dv = new DataView(out.buffer);
  dv.setUint32(total - 4, bitLen >>> 0);
  dv.setUint32(total - 8, Math.floor(bitLen / 2 ** 32));
  return out;
}

function sha256(msg: Uint8Array): DigestBytes {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const data = pad(msg);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let off = 0; off < data.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = new DataView(data.buffer).getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as unknown as number[];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + S1 + ch + K256[t]! + w[t]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a!) >>> 0; H[1] = (H[1]! + b!) >>> 0; H[2] = (H[2]! + c!) >>> 0; H[3] = (H[3]! + d!) >>> 0;
    H[4] = (H[4]! + e!) >>> 0; H[5] = (H[5]! + f!) >>> 0; H[6] = (H[6]! + g!) >>> 0; H[7] = (H[7]! + h!) >>> 0;
  }
  const out = new DigestBytes(32);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, H[i]!);
  return out;
}

function sha1(msg: Uint8Array): DigestBytes {
  const H = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const data = pad(msg);
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let off = 0; off < data.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = new DataView(data.buffer).getUint32(off + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!, 1);
    let [a, b, c, d, e] = H as unknown as number[];
    for (let t = 0; t < 80; t++) {
      let f: number, k: number;
      if (t < 20) { f = (b! & c!) ^ (~b! & d!); k = 0x5a827999; }
      else if (t < 40) { f = b! ^ c! ^ d!; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b! & c!) ^ (b! & d!) ^ (c! & d!); k = 0x8f1bbcdc; }
      else { f = b! ^ c! ^ d!; k = 0xca62c1d6; }
      const tmp = (rotl(a!, 5) + f + e! + k + w[t]!) >>> 0;
      e = d; d = c; c = rotl(b!, 30); b = a; a = tmp;
    }
    H[0] = (H[0]! + a!) >>> 0; H[1] = (H[1]! + b!) >>> 0; H[2] = (H[2]! + c!) >>> 0; H[3] = (H[3]! + d!) >>> 0; H[4] = (H[4]! + e!) >>> 0;
  }
  const out = new DigestBytes(20);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 5; i++) dv.setUint32(i * 4, H[i]!);
  return out;
}

class Hash {
  private chunks: Uint8Array[] = [];
  private algo: string;
  constructor(algo: string) { this.algo = algo; }
  update(data: string | Uint8Array): this {
    this.chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }
  digest(encoding?: string): string | DigestBytes {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const msg = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { msg.set(c, off); off += c.length; }
    const bytes = this.algo === 'sha256' ? sha256(msg) : sha1(msg);
    return encoding === 'hex' ? [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('') : bytes;
  }
}

export function createHash(algo: string): Hash {
  if (algo !== 'sha256' && algo !== 'sha1') throw new Error(`crypto-shim: unsupported algorithm ${algo}`);
  return new Hash(algo);
}
