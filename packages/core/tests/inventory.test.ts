import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SkillRecord } from '@skillscope/shared';
import {
  AdapterRegistry,
  pathKey,
  queryInventory,
  readSkillTree,
  scanInventory,
} from '../src/index.js';
import { adapterContext, cleanup, copyFixture } from './helpers.js';

const registry = new AdapterRegistry();

function byPathEnd(skills: SkillRecord[], suffix: string): SkillRecord {
  const found = skills.find((s) => s.path.replace(/\\/g, '/').endsWith(suffix));
  if (!found) throw new Error(`no skill at ${suffix}`);
  return found;
}

describe('inventory', () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await copyFixture('home/basic');
    workspace = await copyFixture('workspace/basic');
  });

  afterEach(async () => {
    await cleanup(home, workspace);
  });

  it('creates one record per physical skill with per-agent availability', async () => {
    const snap = await scanInventory(registry, adapterContext(home), { followSymlinks: true });
    const shared = byPathEnd(snap.skills, '.agents/skills/code-review');
    expect(shared.availability.map((a) => a.agentId)).toEqual(['codex', 'cursor']);
    expect(shared.sharedLocation).toBe(true);
    expect(shared.statuses).toContain('shared-location');

    const pdf = byPathEnd(snap.skills, '.claude/skills/pdf-tools');
    expect(pdf.availability.map((a) => [a.agentId, a.relation])).toEqual([
      ['claude', 'native'],
      ['cursor', 'compatible'],
    ]);
    expect(pdf.availability[1]?.reason).toMatch(/compatibility location/);
  });

  it('distinguishes unique skills from agent-availability records', async () => {
    const snap = await scanInventory(registry, adapterContext(home), { followSymlinks: true });
    // pdf-tools, code-review (claude), code-review (agents), broken, web-research, react-patterns, legacy-helper
    expect(snap.stats.uniqueSkills).toBe(7);
    expect(snap.stats.perAgent).toEqual({ claude: 4, codex: 1, cursor: 7 });
    expect(snap.stats.availabilityRecords).toBe(12);
    expect(snap.stats.sharedSkills).toBe(5);
    expect(snap.stats.problematicSkills).toBe(1);
  });

  it('detects identical content in different directories', async () => {
    const snap = await scanInventory(registry, adapterContext(home), { followSymlinks: true });
    const contentGroups = snap.duplicateGroups.filter((g) => g.kind === 'content');
    expect(contentGroups).toHaveLength(1);
    const a = byPathEnd(snap.skills, '.claude/skills/code-review');
    const b = byPathEnd(snap.skills, '.agents/skills/code-review');
    expect(a.contentHash).toBe(b.contentHash);
    expect(contentGroups[0]?.skillIds.sort()).toEqual([a.id, b.id].sort());
    expect(a.statuses).toContain('duplicate-content');
  });

  it('detects the same name with different content', async () => {
    await writeFile(
      join(home, '.agents', 'skills', 'code-review', 'SKILL.md'),
      '---\nname: code-review\ndescription: Different text.\n---\n',
    );
    const snap = await scanInventory(registry, adapterContext(home), { followSymlinks: true });
    expect(snap.duplicateGroups.map((g) => g.kind)).toEqual(['name']);
    expect(byPathEnd(snap.skills, '.claude/skills/code-review').statuses).toContain(
      'duplicate-name',
    );
  });

  it('keeps project and global scopes apart and uses stable ids', async () => {
    const first = await scanInventory(registry, adapterContext(home, workspace), {
      followSymlinks: true,
    });
    const second = await scanInventory(registry, adapterContext(home, workspace), {
      followSymlinks: true,
    });
    expect(first.skills.map((s) => s.id)).toEqual(second.skills.map((s) => s.id));
    expect(byPathEnd(first.skills, '.claude/skills/deploy-helper').scope).toBe('project');
    expect(byPathEnd(first.skills, '.claude/skills/pdf-tools').scope).toBe('global');
  });

  it('marks every record as runtime-unverified and missing files as such', async () => {
    const snap = await scanInventory(registry, adapterContext(home), { followSymlinks: true });
    expect(snap.skills.every((s) => s.statuses.includes('runtime-unverified'))).toBe(true);
    const broken = byPathEnd(snap.skills, 'broken-no-skillmd');
    expect(broken.statuses).toContain('missing-required-file');
    expect(broken.validation.state).toBe('invalid');
  });

  it('marks managed skills and detects local changes', async () => {
    const ctx = adapterContext(home);
    const pdfDir = join(home, '.claude', 'skills', 'pdf-tools');
    const tree = await readSkillTree(pdfDir, ctx.platform);
    const key = pathKey(ctx.platform, pdfDir);
    const managed = (k: string) =>
      k === key
        ? {
            receiptId: 'r1',
            packageName: '@acme/pdf',
            version: '1.0.0',
            contentHash: tree.contentHash,
          }
        : null;
    let snap = await scanInventory(registry, ctx, { followSymlinks: true, managed });
    let pdf = byPathEnd(snap.skills, 'pdf-tools');
    expect(pdf.management).toBe('managed');
    expect(pdf.package).toEqual({ name: '@acme/pdf', version: '1.0.0', receiptId: 'r1' });
    expect(pdf.statuses).toContain('installed-skillscope');

    await writeFile(join(pdfDir, 'notes.md'), 'local edit');
    snap = await scanInventory(registry, ctx, { followSymlinks: true, managed });
    pdf = byPathEnd(snap.skills, 'pdf-tools');
    expect(pdf.management).toBe('modified');
    expect(pdf.statuses).toContain('changes-detected');
  });

  it('searches, filters and sorts', async () => {
    const snap = await scanInventory(registry, adapterContext(home, workspace), {
      followSymlinks: true,
    });
    expect(queryInventory(snap.skills, { text: 'pdf' }).map((s) => s.name)).toEqual(['pdf-tools']);
    expect(
      queryInventory(snap.skills, { text: 'DEPLOYMENT checklist' }).map((s) => s.name),
    ).toEqual(['deploy-helper']);
    expect(queryInventory(snap.skills, { agents: ['codex'] }).map((s) => s.name)).toEqual([
      'code-review',
      'repo-conventions',
    ]);
    expect(
      queryInventory(snap.skills, { scopes: ['project'] }).every((s) => s.scope === 'project'),
    ).toBe(true);
    expect(
      queryInventory(snap.skills, { validation: ['invalid'] }).map((s) => s.directoryName),
    ).toEqual(['broken-no-skillmd']);
    expect(queryInventory(snap.skills, { source: 'npm' })).toEqual([]);
    const names = queryInventory(snap.skills, { sort: 'name', direction: 'desc' }).map(
      (s) => s.name,
    );
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
    const byAgent = queryInventory(snap.skills, { sort: 'agent' });
    expect(byAgent[0]?.availability[0]?.agentId).toBe('claude');
    expect(queryInventory(snap.skills, { sort: 'modified' })).toHaveLength(snap.skills.length);
  });
});
