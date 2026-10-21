import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InventorySnapshot } from '@skillscope/shared';
import { AdapterRegistry, exportInventory, scanInventory } from '../src/index.js';
import { adapterContext, cleanup, copyFixture } from './helpers.js';

const OUT = resolve(import.meta.dirname, '../../../docs/examples');

/** Replace temporary directories with readable placeholders so reports are stable. */
function anonymise(
  snapshot: InventorySnapshot,
  home: string,
  workspace: string,
): InventorySnapshot {
  const json = JSON.stringify(snapshot)
    .split(workspace.replace(/\\/g, '\\\\'))
    .join('/home/you/projects/web-app')
    .split(home.replace(/\\/g, '\\\\'))
    .join('/home/you');
  return {
    ...(JSON.parse(json) as InventorySnapshot),
    generatedAt: '2026-10-21T12:00:00.000Z',
    scanDurationMs: 42,
  };
}

// Regenerate with: SKILLSCOPE_WRITE_EXAMPLES=1 npx vitest run --project core tests/examples.test.ts
describe.runIf(process.env.SKILLSCOPE_WRITE_EXAMPLES)('example reports', () => {
  it('writes JSON, CSV and Markdown reports for the fixture home and workspace', async () => {
    const home = await copyFixture('home/basic');
    const workspace = await copyFixture('workspace/basic');
    try {
      const raw = await scanInventory(new AdapterRegistry(), adapterContext(home, workspace), {
        followSymlinks: true,
      });
      const snapshot = anonymise(raw, home, workspace);
      const now = new Date('2026-10-21T12:00:00.000Z');
      await mkdir(OUT, { recursive: true });
      await writeFile(join(OUT, 'inventory.json'), exportInventory(snapshot, 'json', now));
      await writeFile(join(OUT, 'inventory.csv'), exportInventory(snapshot, 'csv', now));
      await writeFile(join(OUT, 'inventory.md'), exportInventory(snapshot, 'markdown', now));
      expect(snapshot.stats.uniqueSkills).toBe(10);
    } finally {
      await cleanup(home, workspace);
    }
  });
});
