/**
 * esbuild alias target for `node:fs` in the browser bundle. Only loadBatch()
 * (fixture loading from disk) uses fs; the browser entry imports fixture JSON
 * directly and calls parseBatch(), so any fs call in a browser is a bug.
 */
export function readFileSync(): never {
  throw new Error('node:fs is unavailable in the browser bundle; import fixture JSON and use parseBatch()');
}
