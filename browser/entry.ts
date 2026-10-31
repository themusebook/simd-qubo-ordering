/**
 * Browser entry for the reference client, bundled by esbuild into
 * browser/dist/simd-client.js (see package.json "build:browser"):
 * the real src/ modules with node:crypto aliased to ./crypto-shim.ts and
 * node:fs stubbed out. This replaces the demo page's former hand-ported
 * inline engine — page and repo can no longer drift.
 */
import { parseBatch } from '../src/fixtures.ts';
import { run } from '../src/pipeline.ts';
import { serializeRun, type SerializedRun } from '../src/serialize.ts';
import sandwich from '../fixtures/sandwich.json';
import mixed from '../fixtures/mixed.json';
import devnet from '../fixtures/devnet.json';

export const SCENARIOS = ['sandwich', 'mixed', 'devnet'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const RAW: Record<Scenario, unknown> = { sandwich, mixed, devnet };

/** Run the full spec-mode pipeline (encode -> solve -> polish -> verify -> accept/fallback) on a fixture batch, in this browser. */
export async function runScenario(name: Scenario): Promise<SerializedRun> {
  if (!SCENARIOS.includes(name)) throw new Error(`unknown scenario: ${name}`);
  // Deep-copy: fixtures are module-level JSON; parseBatch builds fresh bigint state from it.
  const batch = parseBatch(JSON.parse(JSON.stringify(RAW[name])));
  return serializeRun(await run(batch)); // spec mode: sha256 tie-break, canonical revert baseline
}

export { serializeRun };
export type { SerializedRun };
