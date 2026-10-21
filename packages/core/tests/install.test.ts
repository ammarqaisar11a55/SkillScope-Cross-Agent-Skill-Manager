import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSkillTree } from '../src/index.js';
import { createTestApp, type TestApp } from './app-helpers.js';
import { isRoot } from './helpers.js';
import { tarFixture } from './package-helpers.js';

const PKG = '@acme/agent-skills';

async function setup(): Promise<TestApp> {
  return createTestApp({
    [PKG]: { versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } } },
  });
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function hiddenLeftovers(root: string): Promise<string[]> {
  return (await readdir(root).catch(() => [] as string[])).filter((n) =>
    n.startsWith('.skillscope-'),
  );
}

describe('independent installation', () => {
  let t: TestApp;
  afterEach(async () => t?.dispose());

  it('installs one package separately into Claude Code, Codex and Cursor', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review'],
      targets: [
        { agentId: 'claude', scope: 'global' },
        { agentId: 'codex', scope: 'global' },
        { agentId: 'cursor', scope: 'global' },
      ],
      allowSharedInstall: false,
    });
    expect(plan.targets.map((x) => x.destination)).toEqual([
      join(t.home, '.claude', 'skills', 'code-review'),
      join(t.home, '.agents', 'skills', 'code-review'),
      join(t.home, '.cursor', 'skills', 'code-review'),
    ]);
    expect(plan.targets.every((x) => x.conflict === null && !x.shared)).toBe(true);
    expect(plan.warnings[0]).toMatch(/third-party content/);

    await expect(t.app.executeInstall(plan.id, 'abort', false)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    const result = await t.app.executeInstall(plan.id, 'abort', true);
    expect(result.operation.state).toBe('succeeded');
    expect(result.receipts.map((r) => r.agentIds)).toEqual([['claude'], ['codex'], ['cursor']]);
    for (const r of result.receipts) {
      expect(await readFile(join(r.destination, 'SKILL.md'), 'utf8')).toContain(
        'name: code-review',
      );
      expect(r.files).toEqual([
        {
          path: 'SKILL.md',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          size: expect.any(Number),
        },
      ]);
    }
    // Only the declared skill directory is installed, never the rest of the package.
    expect(await exists(join(t.home, '.claude', 'skills', 'code-review', 'package.json'))).toBe(
      false,
    );
    expect(await exists(join(t.home, '.claude', 'skills', 'test-writer'))).toBe(false);

    const inventory = t.app.cachedInventory();
    const managed = inventory?.skills.filter((s) => s.management === 'managed') ?? [];
    expect(managed).toHaveLength(3);
    expect(managed.every((s) => s.package?.name === PKG)).toBe(true);
    expect(await t.app.receiptStates()).toHaveLength(3);
  });

  it('shares one copy only when explicitly allowed and the agents read the same folder', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review'],
      targets: [
        { agentId: 'codex', scope: 'global' },
        { agentId: 'cursor', scope: 'global' },
      ],
      allowSharedInstall: true,
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({
      agentIds: ['codex', 'cursor'],
      shared: true,
      destination: join(t.home, '.agents', 'skills', 'code-review'),
    });
    expect(plan.targets[0]?.note).toMatch(/one copy/);
  });

  it('installs at project scope inside the workspace', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['test-writer'],
      targets: [{ agentId: 'claude', scope: 'project' }],
      allowSharedInstall: false,
    });
    expect(plan.targets[0]?.destination).toBe(
      join(t.workspace, '.claude', 'skills', 'test-writer'),
    );
    await t.app.executeInstall(plan.id, 'abort', true);
    expect(
      await readFile(
        join(t.workspace, '.claude', 'skills', 'test-writer', 'references', 'GUIDE.md'),
        'utf8',
      ),
    ).toContain('Testing');
  });

  it('warns when a skill does not declare support for the chosen agent', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['test-writer'],
      targets: [{ agentId: 'codex', scope: 'global' }],
      allowSharedInstall: false,
    });
    expect(plan.warnings.some((w) => w.includes('does not declare support for OpenAI Codex'))).toBe(
      true,
    );
  });

  it('refuses unknown install roots and compatibility-only roots', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    await expect(
      t.app.planInstall({
        stagingId: inspection.stagingId,
        skills: ['code-review'],
        targets: [{ agentId: 'cursor', scope: 'global', rootId: 'cursor:global:compat-claude' }],
        allowSharedInstall: false,
      }),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
  });

  it('detects conflicts and never overwrites silently', async () => {
    t = await setup();
    const existing = join(t.home, '.claude', 'skills', 'code-review');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'SKILL.md'), '---\nname: code-review\ndescription: mine\n---\n');
    await writeFile(join(existing, 'notes.md'), 'my notes');
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review'],
      targets: [{ agentId: 'claude', scope: 'global' }],
      allowSharedInstall: false,
    });
    const conflict = plan.targets[0]?.conflict;
    expect(conflict).toMatchObject({ kind: 'external', identical: false, existingPath: existing });
    expect(conflict?.diff).toEqual([
      { path: 'SKILL.md', change: 'modified' },
      { path: 'notes.md', change: 'removed' },
    ]);
    await expect(t.app.executeInstall(plan.id, 'abort', true)).rejects.toMatchObject({
      code: 'TARGET_CONFLICT',
    });
    expect(await readFile(join(existing, 'SKILL.md'), 'utf8')).toContain('mine');

    const result = await t.app.executeInstall(plan.id, 'replace', true);
    const receipt = result.receipts[0];
    expect(receipt?.backupPath).toBeTruthy();
    expect(await readFile(join(receipt?.backupPath ?? '', 'notes.md'), 'utf8')).toBe('my notes');
    expect(await readFile(join(existing, 'SKILL.md'), 'utf8')).toContain('Review a diff');
    expect(await hiddenLeftovers(join(t.home, '.claude', 'skills'))).toEqual([]);

    const restored = await t.app.restoreBackup(receipt?.id ?? '', true);
    expect(restored.status).toBe('removed');
    expect(await readFile(join(existing, 'notes.md'), 'utf8')).toBe('my notes');
  });

  it('refuses a plan that became stale because the target appeared', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review'],
      targets: [{ agentId: 'claude', scope: 'global' }],
      allowSharedInstall: false,
    });
    await mkdir(join(t.home, '.claude', 'skills', 'code-review'), { recursive: true });
    await expect(t.app.executeInstall(plan.id, 'replace', true)).rejects.toMatchObject({
      code: 'TARGET_CONFLICT',
    });
  });

  it('rolls back every target when a later target fails', async () => {
    t = await setup();
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review', 'test-writer'],
      targets: [
        { agentId: 'claude', scope: 'global' },
        { agentId: 'cursor', scope: 'global' },
      ],
      allowSharedInstall: false,
    });
    expect(plan.targets).toHaveLength(4);
    t.app.installFault = (point, index) => {
      if (point === 'before-commit' && index === 2) throw new Error('simulated disk failure');
    };
    await expect(t.app.executeInstall(plan.id, 'abort', true)).rejects.toMatchObject({
      code: 'INSTALL_FAILED',
    });
    expect(await exists(join(t.home, '.claude', 'skills'))).toBe(false);
    expect(await exists(join(t.home, '.cursor', 'skills'))).toBe(false);
    expect(t.store.listReceipts()).toEqual([]);
    const op = t.store
      .listOperations()
      .find((o) => o.kind === 'install' && o.summary.startsWith('Install'));
    expect(op?.state).toBe('rolled-back');
    expect(await readdir(join(t.data, 'journal')).catch(() => [])).toEqual([]);
  });

  it('restores a replaced skill when the replacement fails', async () => {
    t = await setup();
    const existing = join(t.home, '.claude', 'skills', 'code-review');
    await mkdir(existing, { recursive: true });
    await writeFile(join(existing, 'SKILL.md'), 'original');
    const inspection = await t.app.inspectPackage(PKG, '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review'],
      targets: [{ agentId: 'claude', scope: 'global' }],
      allowSharedInstall: false,
    });
    t.app.installFault = (point) => {
      if (point === 'after-commit') throw new Error('crash after rename');
    };
    await expect(t.app.executeInstall(plan.id, 'replace', true)).rejects.toThrow();
    expect(await readFile(join(existing, 'SKILL.md'), 'utf8')).toBe('original');
    expect(await hiddenLeftovers(join(t.home, '.claude', 'skills'))).toEqual([]);
  });

  it('recovers an interrupted installation on startup from its journal', async () => {
    t = await setup();
    const root = join(t.home, '.claude', 'skills');
    const destination = join(root, 'code-review');
    const backup = join(root, '.skillscope-backup-deadbeef-0');
    const tmp = join(root, '.skillscope-tmp-deadbeef-0');
    // State after a crash: the old skill was moved aside and the new one committed.
    await mkdir(backup, { recursive: true });
    await writeFile(join(backup, 'SKILL.md'), 'original');
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'SKILL.md'), 'new');
    await mkdir(tmp, { recursive: true });
    const incomingHash = (await readSkillTree(destination, t.app.platform)).contentHash;
    await mkdir(join(t.data, 'journal'), { recursive: true });
    await writeFile(
      join(t.data, 'journal', 'op_crashed.json'),
      JSON.stringify({
        operationId: 'op_crashed',
        startedAt: new Date().toISOString(),
        steps: [
          {
            targetId: 't',
            destination,
            tmp,
            backup,
            createdDirs: [],
            incomingHash,
            phase: 'committed',
          },
        ],
      }),
    );
    const result = await t.app.initialize();
    expect(result.recovered).toBe(1);
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe('original');
    expect(await hiddenLeftovers(root)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32' || isRoot)(
    'reports permission errors and leaves nothing behind',
    async () => {
      t = await setup();
      const root = join(t.home, '.claude', 'skills');
      await mkdir(root, { recursive: true });
      await chmod(root, 0o555);
      try {
        const inspection = await t.app.inspectPackage(PKG, '1.0.0');
        const plan = await t.app.planInstall({
          stagingId: inspection.stagingId,
          skills: ['code-review'],
          targets: [{ agentId: 'claude', scope: 'global' }],
          allowSharedInstall: false,
        });
        const error = await t.app.executeInstall(plan.id, 'abort', true).catch((e: unknown) => e);
        expect(error).toMatchObject({ code: 'PERMISSION_DENIED' });
        expect(await readdir(root)).toEqual([]);
      } finally {
        await chmod(root, 0o755);
      }
    },
  );
});
