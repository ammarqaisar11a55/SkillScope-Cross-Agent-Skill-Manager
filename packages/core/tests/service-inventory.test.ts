import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillScopeService, SkillScopeStore, createPlatformContext } from '../src/index.js';
import { canSymlink, cleanup, copyFixture, tempDir } from './helpers.js';

describe('SkillScopeService inventory operations', () => {
  let home: string;
  let data: string;
  let service: SkillScopeService;
  let store: SkillScopeStore;

  beforeEach(async () => {
    home = await copyFixture('home/basic');
    data = await tempDir();
    store = await SkillScopeStore.open(join(data, 'skillscope.db'));
    service = new SkillScopeService({
      store,
      dataDir: data,
      platform: createPlatformContext({ homeDir: home, env: {} }),
    });
    await service.updateSettings({
      scan: { ...service.settings().scan, includeSystemRoots: false },
    });
  });

  afterEach(async () => {
    store.close();
    await cleanup(home, data);
  });

  it('scans, caches the snapshot and logs the operation', async () => {
    expect(service.cachedInventory()).toBeNull();
    const snap = await service.scan();
    expect(snap.stats.uniqueSkills).toBe(7);
    expect(service.cachedInventory()?.generatedAt).toBe(snap.generatedAt);
    const reopened = await SkillScopeStore.open(join(data, 'skillscope.db'));
    expect(reopened.latestSnapshot()?.fromCache).toBe(true);
    reopened.close();
    expect(store.listOperations()[0]).toMatchObject({ kind: 'scan', state: 'succeeded' });
  });

  it('shares one scan between concurrent callers', async () => {
    const [a, b] = await Promise.all([service.scan(), service.scan()]);
    expect(a).toBe(b);
  });

  it('returns skill details with files, SKILL.md and duplicates', async () => {
    const snap = await service.scan();
    const cr = snap.skills.find((s) => s.path.includes('.claude') && s.name === 'code-review');
    const details = await service.skillDetails(cr?.id ?? '');
    expect(details.skillMd).toContain('# Code review');
    expect(details.files.map((f) => f.path)).toEqual(['SKILL.md']);
    expect(details.duplicates).toHaveLength(1);
  });

  it('reads files inside a skill and refuses anything that escapes it', async ({ skip }) => {
    const snap = await service.scan();
    const pdf = snap.skills.find((s) => s.name === 'pdf-tools');
    const id = pdf?.id ?? '';
    expect((await service.readSkillFile(id, 'scripts/extract.py')).content).toContain('def main');
    await expect(service.readSkillFile(id, '../code-review/SKILL.md')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ROOT',
    });
    if (!(await canSymlink())) skip();
    await writeFile(join(home, 'secret.txt'), 'top secret');
    await symlink(join(home, 'secret.txt'), join(pdf?.path ?? '', 'leak.txt'));
    await expect(service.readSkillFile(id, 'leak.txt')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ROOT',
    });
  });

  it('rejects unknown skill ids', async () => {
    await expect(service.skillDetails('sk_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates settings, including the workspace folder', async () => {
    await expect(
      service.updateSettings({ workspaceRoot: join(home, 'nope') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.updateSettings({ workspaceRoot: 'relative/path' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const ws = join(home, 'project');
    await mkdir(ws);
    expect((await service.updateSettings({ workspaceRoot: ws })).workspaceRoot).toBe(ws);
    await expect(
      service.updateSettings({
        customLocations: [
          {
            id: 'x',
            agentId: 'claude',
            scope: 'global',
            path: 'relative',
            label: 'X',
            installable: true,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('persists theme preference', async () => {
    await service.updateSettings({ theme: 'dark' });
    const reopened = await SkillScopeStore.open(join(data, 'skillscope.db'));
    expect(reopened.getSettings().theme).toBe('dark');
    reopened.close();
  });
});
