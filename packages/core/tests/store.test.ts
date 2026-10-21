import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstallationReceipt, InventorySnapshot, OperationRecord } from '@skillscope/shared';
import { DEFAULT_SETTINGS } from '@skillscope/shared';
import { SkillScopeStore } from '../src/index.js';
import { cleanup, tempDir } from './helpers.js';

function receipt(id: string, overrides: Partial<InstallationReceipt> = {}): InstallationReceipt {
  return {
    id,
    packageName: '@acme/skills',
    version: '1.0.0',
    integrity: 'sha512-x',
    skillName: 'code-review',
    agentIds: ['claude'],
    scope: 'global',
    rootId: 'claude:global:personal',
    rootPath: '/home/a/.claude/skills',
    destination: '/home/a/.claude/skills/code-review',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [{ path: 'SKILL.md', sha256: 'abc', size: 10 }],
    contentHash: 'h',
    backupPath: null,
    status: 'installed',
    ...overrides,
  };
}

const snapshot = {
  generatedAt: '2026-10-21T00:00:00.000Z',
  platform: 'linux',
  workspaceRoot: null,
  skills: [],
  agents: [],
  roots: [],
  duplicateGroups: [],
  stats: {
    uniqueSkills: 3,
    availabilityRecords: 5,
    perAgent: { claude: 1, codex: 2, cursor: 2 },
    detectedAgents: 2,
    sharedSkills: 1,
    duplicateGroups: 0,
    problematicSkills: 1,
  },
  fromCache: false,
  scanDurationMs: 12,
} satisfies InventorySnapshot;

describe('SkillScopeStore', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await tempDir();
    file = join(dir, 'data', 'skillscope.db');
  });
  afterEach(async () => cleanup(dir));

  it('persists settings across reopen and falls back to defaults', async () => {
    let store = await SkillScopeStore.open(file);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    await store.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    store.close();
    store = await SkillScopeStore.open(file);
    expect(store.getSettings().theme).toBe('dark');
    store.close();
  });

  it('keeps the last inventory for offline viewing and records scan history', async () => {
    let store = await SkillScopeStore.open(file);
    await store.saveSnapshot(snapshot);
    await store.saveSnapshot({ ...snapshot, generatedAt: '2026-10-22T00:00:00.000Z' });
    store.close();
    store = await SkillScopeStore.open(file);
    const cached = store.latestSnapshot();
    expect(cached?.fromCache).toBe(true);
    expect(cached?.generatedAt).toBe('2026-10-22T00:00:00.000Z');
    expect(store.scanHistory()).toHaveLength(2);
    store.close();
  });

  it('stores receipts and finds the active one by destination', async () => {
    const store = await SkillScopeStore.open(null);
    await store.saveReceipts([
      { receipt: receipt('r1'), destinationKey: 'k1' },
      { receipt: receipt('r2', { status: 'removed' }), destinationKey: 'k2' },
    ]);
    expect(store.activeReceiptAt('k1')?.id).toBe('r1');
    expect(store.activeReceiptAt('k2')).toBeNull();
    expect(store.listReceipts().map((r) => r.id)).toEqual(['r1']);
    expect(store.listReceipts(true)).toHaveLength(2);
    store.close();
  });

  it('prunes old history but keeps installed receipts', async () => {
    const store = await SkillScopeStore.open(null);
    const op: OperationRecord = {
      id: 'op1',
      kind: 'scan',
      state: 'succeeded',
      startedAt: '2020-01-01T00:00:00.000Z',
      finishedAt: null,
      summary: 's',
      packageName: null,
      version: null,
      details: [],
      error: null,
    };
    await store.saveOperation(op);
    await store.saveOperation({ ...op, id: 'op2', startedAt: '2026-10-20T00:00:00.000Z' });
    await store.saveReceipt(
      receipt('old-installed', { updatedAt: '2020-01-01T00:00:00.000Z' }),
      'a',
    );
    await store.saveReceipt(
      receipt('old-removed', { status: 'removed', updatedAt: '2020-01-01T00:00:00.000Z' }),
      'b',
    );
    await store.pruneHistory(30, new Date('2026-10-21T00:00:00.000Z'));
    expect(store.listOperations().map((o) => o.id)).toEqual(['op2']);
    expect(store.listReceipts(true).map((r) => r.id)).toEqual(['old-installed']);
    store.close();
  });

  it('recovers from a corrupted database file by starting fresh', async () => {
    const store = await SkillScopeStore.open(file);
    store.close();
    await writeFile(file, 'this is not sqlite');
    const reopened = await SkillScopeStore.open(file);
    expect(reopened.getSettings()).toEqual(DEFAULT_SETTINGS);
    reopened.close();
    expect((await readFile(file)).subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
