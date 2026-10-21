import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, discoverSkills, scanPath, type SkillSighting } from '../src/index.js';
import {
  adapterContext,
  canSymlink,
  cleanup,
  copyFixture,
  isRoot,
  tempDir,
  treeSnapshot,
} from './helpers.js';

const registry = new AdapterRegistry();

function names(sightings: SkillSighting[], agent: string): string[] {
  return sightings
    .filter((s) => s.root.agentId === agent)
    .map((s) => s.skill.dir.split(/[\\/]/).pop() as string)
    .sort();
}

describe('discovery', () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await copyFixture('home/basic');
    workspace = await copyFixture('workspace/basic');
  });

  afterEach(async () => {
    await cleanup(home, workspace);
  });

  it('finds global skills independently for each agent', async () => {
    const result = await discoverSkills(registry, adapterContext(home), { followSymlinks: true });
    expect(names(result.sightings, 'claude')).toEqual([
      'broken-no-skillmd',
      'code-review',
      'pdf-tools',
      'web-research',
    ]);
    expect(names(result.sightings, 'codex')).toEqual(['code-review']);
    expect(names(result.sightings, 'cursor')).toEqual([
      'broken-no-skillmd',
      'code-review',
      'code-review',
      'legacy-helper',
      'pdf-tools',
      'react-patterns',
      'web-research',
    ]);
  });

  it('records why Cursor sees Claude skills (compatible root, not a Cursor install)', async () => {
    const result = await discoverSkills(registry, adapterContext(home), { followSymlinks: true });
    const pdfForCursor = result.sightings.find(
      (s) => s.root.agentId === 'cursor' && s.skill.dir.endsWith('pdf-tools'),
    );
    expect(pdfForCursor?.root.relation).toBe('compatible');
    expect(pdfForCursor?.root.id).toBe('cursor:global:compat-claude');
  });

  it('supports category folders for recursive roots only', async () => {
    const result = await discoverSkills(registry, adapterContext(home), { followSymlinks: true });
    const react = result.sightings.find((s) => s.skill.dir.endsWith('react-patterns'));
    expect(react?.skill.depth).toBe(2);
    expect(react?.root.agentId).toBe('cursor');
  });

  it('separates project-level skills when a workspace is selected', async () => {
    const result = await discoverSkills(registry, adapterContext(home, workspace), {
      followSymlinks: true,
    });
    const project = result.sightings.filter((s) => s.root.scope === 'project');
    expect(
      project
        .filter((s) => s.root.agentId === 'claude')
        .map((s) => s.skill.dir.split(/[\\/]/).pop()),
    ).toEqual(['deploy-helper']);
    expect(
      project
        .filter((s) => s.root.agentId === 'codex')
        .map((s) => s.skill.dir.split(/[\\/]/).pop()),
    ).toEqual(['repo-conventions']);
    expect(
      project
        .filter((s) => s.root.agentId === 'cursor')
        .map((s) => s.skill.dir.split(/[\\/]/).pop())
        .sort(),
    ).toEqual(['deploy-helper', 'repo-conventions', 'ui-review']);
  });

  it('reports a folder without SKILL.md as a broken skill', async () => {
    const result = await discoverSkills(registry, adapterContext(home), { followSymlinks: true });
    const broken = result.sightings.find((s) => s.skill.dir.endsWith('broken-no-skillmd'));
    expect(broken?.skill.skillFile).toBeNull();
  });

  it('does not report the synced root as a broken Claude skill', async () => {
    const result = await discoverSkills(registry, adapterContext(home), { followSymlinks: true });
    expect(result.sightings.some((s) => s.skill.dir.endsWith('synced'))).toBe(false);
  });

  it('never modifies scanned files or creates missing directories', async () => {
    const emptyHome = await tempDir();
    try {
      const before = await treeSnapshot(home);
      await discoverSkills(registry, adapterContext(home, workspace), { followSymlinks: true });
      expect(await treeSnapshot(home)).toEqual(before);

      const result = await discoverSkills(registry, adapterContext(emptyHome), {
        followSymlinks: true,
      });
      expect(await treeSnapshot(emptyHome)).toEqual({});
      expect(result.roots.every((r) => !r.exists)).toBe(true);
      expect(result.agents.every((a) => !a.detected)).toBe(true);
      expect(result.agents[0]?.diagnostics.some((d) => d.code === 'root.none-exist')).toBe(true);
    } finally {
      await cleanup(emptyHome);
    }
  });

  it('detects agents from configuration directories without reading them', async () => {
    const result = await discoverSkills(registry, adapterContext(home), { followSymlinks: true });
    const claude = result.agents.find((a) => a.agentId === 'claude');
    expect(claude?.detected).toBe(true);
    expect(claude?.evidence.some((e) => e.endsWith('.claude'))).toBe(true);
  });

  it('skips dependency folders and hidden directories', async () => {
    const root = join(home, '.cursor', 'skills');
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'SKILL.md'), '---\nname: pkg\n---\n');
    await mkdir(join(root, '.hidden', 'x'), { recursive: true });
    await writeFile(join(root, '.hidden', 'x', 'SKILL.md'), '---\nname: x\n---\n');
    const scan = await scanPath(root, {
      ctx: adapterContext(home).platform,
      maxDepth: 4,
      followSymlinks: true,
    });
    expect(scan.skills.map((s) => s.dir.split(/[\\/]/).pop())).toEqual(['react-patterns']);
  });

  it('reports a wrongly-cased skill file name', async () => {
    const dir = join(home, '.claude', 'skills', 'lower-case');
    await mkdir(dir);
    await writeFile(join(dir, 'skill.md'), '---\nname: lower-case\ndescription: x\n---\n');
    const scan = await scanPath(join(home, '.claude', 'skills'), {
      ctx: adapterContext(home).platform,
      maxDepth: 1,
      followSymlinks: true,
    });
    const found = scan.skills.find((s) => s.dir.endsWith('lower-case'));
    expect(found?.skillFileName?.toLowerCase()).toBe('skill.md');
  });

  it('follows symlinked skills, records the real path and survives cycles', async ({ skip }) => {
    if (!(await canSymlink())) skip();
    const root = join(home, '.claude', 'skills');
    const external = await tempDir();
    try {
      await mkdir(join(external, 'linked-skill'));
      await writeFile(
        join(external, 'linked-skill', 'SKILL.md'),
        '---\nname: linked-skill\ndescription: d\n---\n',
      );
      await symlink(join(external, 'linked-skill'), join(root, 'linked-skill'), 'dir');
      await symlink(root, join(home, '.cursor', 'skills', 'loop'), 'dir');
      const ctx = adapterContext(home);
      const scan = await scanPath(root, { ctx: ctx.platform, maxDepth: 1, followSymlinks: true });
      const linked = scan.skills.find((s) => s.dir.endsWith('linked-skill'));
      expect(linked?.isSymlink).toBe(true);
      expect(linked?.realDir).toContain(external.split(/[\\/]/).pop() as string);

      const noFollow = await scanPath(root, {
        ctx: ctx.platform,
        maxDepth: 1,
        followSymlinks: false,
      });
      expect(noFollow.skills.some((s) => s.dir.endsWith('linked-skill'))).toBe(false);

      const cursorScan = await scanPath(join(home, '.cursor', 'skills'), {
        ctx: ctx.platform,
        maxDepth: 4,
        followSymlinks: true,
      });
      expect(cursorScan.skills.length).toBeGreaterThan(0);
    } finally {
      await cleanup(external);
    }
  });

  it('reports a broken symlink as a warning, not a crash', async ({ skip }) => {
    if (!(await canSymlink())) skip();
    const root = join(home, '.claude', 'skills');
    await symlink(join(home, 'does-not-exist'), join(root, 'dangling'), 'dir');
    const scan = await scanPath(root, {
      ctx: adapterContext(home).platform,
      maxDepth: 1,
      followSymlinks: true,
    });
    expect(scan.warnings.some((w) => w.includes('dangling'))).toBe(true);
  });

  it.skipIf(process.platform === 'win32' || isRoot)(
    'handles an unreadable root safely',
    async () => {
      const root = join(home, '.claude', 'skills');
      await chmod(root, 0o000);
      try {
        const result = await discoverSkills(registry, adapterContext(home), {
          followSymlinks: true,
        });
        const status = result.roots.find((r) => r.root.id === 'claude:global:personal');
        expect(status?.exists).toBe(true);
        expect(status?.readable).toBe(false);
        expect(status?.error).toBe('permission denied');
        const claude = result.agents.find((a) => a.agentId === 'claude');
        expect(claude?.diagnostics.some((d) => d.code === 'root.unreadable')).toBe(true);
      } finally {
        await chmod(root, 0o755);
      }
    },
  );

  it('reports a root that is a file', async () => {
    const fakeHome = await tempDir();
    try {
      await mkdir(join(fakeHome, '.claude'));
      await writeFile(join(fakeHome, '.claude', 'skills'), 'not a dir');
      const scan = await scanPath(join(fakeHome, '.claude', 'skills'), {
        ctx: adapterContext(fakeHome).platform,
        maxDepth: 1,
        followSymlinks: true,
      });
      expect(scan.exists).toBe(true);
      expect(scan.error).toBe('not a directory');
    } finally {
      await cleanup(fakeHome);
    }
  });
});
