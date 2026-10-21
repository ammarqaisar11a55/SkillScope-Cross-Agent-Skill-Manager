import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app-helpers.js';
import { tarFixture } from './package-helpers.js';

const PKG = '@acme/agent-skills';

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function setupInstalled(): Promise<TestApp> {
  const v1 = await tarFixture('multi-skill');
  const v2 = await tarFixture('multi-skill', [
    {
      name: 'package/skills/code-review/SKILL.md',
      content:
        '---\nname: code-review\ndescription: Version 2 of the review skill. Use before merging.\n---\n\nNew instructions.\n',
    },
    { name: 'package/skills/code-review/references/CHECKLIST.md', content: '# Checklist' },
  ]);
  const t = await createTestApp({
    [PKG]: { versions: { '1.0.0': { tarball: v1 }, '2.0.0': { tarball: v2 } }, latest: '2.0.0' },
  });
  const inspection = await t.app.inspectPackage(PKG, '1.0.0');
  const plan = await t.app.planInstall({
    stagingId: inspection.stagingId,
    skills: ['code-review', 'test-writer'],
    targets: [{ agentId: 'claude', scope: 'global' }],
    allowSharedInstall: false,
  });
  await t.app.executeInstall(plan.id, 'abort', true);
  return t;
}

function receiptFor(t: TestApp, skill: string) {
  const r = t.store.listReceipts().find((x) => x.skillName === skill);
  if (!r) throw new Error(`no receipt for ${skill}`);
  return r;
}

describe('updates', () => {
  let t: TestApp;
  afterEach(async () => t?.dispose());

  it('detects available updates', async () => {
    t = await setupInstalled();
    const checks = await t.app.checkUpdates();
    expect(checks.map((c) => [c.skillName, c.installed, c.latest, c.updateAvailable])).toEqual(
      expect.arrayContaining([
        ['code-review', '1.0.0', '2.0.0', true],
        ['test-writer', '1.0.0', '2.0.0', true],
      ]),
    );
  });

  it('previews and applies an update to one skill without touching its sibling', async () => {
    t = await setupInstalled();
    const cr = receiptFor(t, 'code-review');
    const tw = receiptFor(t, 'test-writer');
    const twBefore = await readFile(join(tw.destination, 'SKILL.md'), 'utf8');
    const preview = await t.app.previewUpdate(cr.id);
    expect(preview).toMatchObject({
      from: '1.0.0',
      to: '2.0.0',
      localModifications: [],
      skillPresentInNewVersion: true,
    });
    expect(preview.diff).toEqual([
      { path: 'SKILL.md', change: 'modified' },
      { path: 'references/CHECKLIST.md', change: 'added' },
    ]);
    const result = await t.app.applyUpdate(cr.id, preview.stagingId, true, false);
    expect(result.receipts[0]?.version).toBe('2.0.0');
    expect(await readFile(join(cr.destination, 'SKILL.md'), 'utf8')).toContain('Version 2');
    expect(await readFile(join(tw.destination, 'SKILL.md'), 'utf8')).toBe(twBefore);
    expect(receiptFor(t, 'test-writer').version).toBe('1.0.0');
    expect(result.receipts[0]?.backupPath).toBeTruthy();
  });

  it('protects locally modified files unless overwriting is confirmed', async () => {
    t = await setupInstalled();
    const cr = receiptFor(t, 'code-review');
    await writeFile(join(cr.destination, 'SKILL.md'), 'my local edits');
    const preview = await t.app.previewUpdate(cr.id);
    expect(preview.localModifications).toEqual(['SKILL.md']);
    await expect(t.app.applyUpdate(cr.id, preview.stagingId, true, false)).rejects.toMatchObject({
      code: 'MODIFIED_FILES',
    });
    expect(await readFile(join(cr.destination, 'SKILL.md'), 'utf8')).toBe('my local edits');
    const result = await t.app.applyUpdate(cr.id, preview.stagingId, true, true);
    expect(await readFile(join(result.receipts[0]?.backupPath ?? '', 'SKILL.md'), 'utf8')).toBe(
      'my local edits',
    );
  });

  it('marks modified managed skills in the inventory', async () => {
    t = await setupInstalled();
    const cr = receiptFor(t, 'code-review');
    await writeFile(join(cr.destination, 'extra.md'), 'added by me');
    const snap = await t.app.scan();
    const record = snap.skills.find((s) => s.path === cr.destination);
    expect(record?.management).toBe('modified');
    expect(record?.statuses).toContain('changes-detected');
  });
});

describe('removal', () => {
  let t: TestApp;
  afterEach(async () => t?.dispose());

  it('removes only the selected managed skill', async () => {
    t = await setupInstalled();
    const cr = receiptFor(t, 'code-review');
    const tw = receiptFor(t, 'test-writer');
    const external = join(t.home, '.claude', 'skills', 'my-own-skill');
    await mkdir(external, { recursive: true });
    await writeFile(
      join(external, 'SKILL.md'),
      '---\nname: my-own-skill\ndescription: mine\n---\n',
    );

    const preview = await t.app.previewRemoval(cr.id);
    expect(preview).toMatchObject({
      filesToRemove: ['SKILL.md'],
      modifiedFiles: [],
      unownedFiles: [],
    });
    await expect(t.app.remove(cr.id, false, false)).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    await t.app.remove(cr.id, false, true);
    expect(await exists(cr.destination)).toBe(false);
    expect(await exists(join(tw.destination, 'SKILL.md'))).toBe(true);
    expect(await exists(join(external, 'SKILL.md'))).toBe(true);
    expect(t.store.getReceipt(cr.id)?.status).toBe('removed');
  });

  it('keeps files the user added and, by default, files the user modified', async () => {
    t = await setupInstalled();
    const tw = receiptFor(t, 'test-writer');
    await writeFile(join(tw.destination, 'my-notes.md'), 'keep me');
    await writeFile(join(tw.destination, 'references', 'GUIDE.md'), 'edited guide');
    const preview = await t.app.previewRemoval(tw.id);
    expect(preview.unownedFiles).toEqual(['my-notes.md']);
    expect(preview.modifiedFiles).toEqual(['references/GUIDE.md']);
    await t.app.remove(tw.id, false, true);
    expect(await readFile(join(tw.destination, 'my-notes.md'), 'utf8')).toBe('keep me');
    expect(await readFile(join(tw.destination, 'references', 'GUIDE.md'), 'utf8')).toBe(
      'edited guide',
    );
    expect(await exists(join(tw.destination, 'SKILL.md'))).toBe(false);
  });

  it('removes modified files only when asked, still keeping unowned files', async () => {
    t = await setupInstalled();
    const tw = receiptFor(t, 'test-writer');
    await writeFile(join(tw.destination, 'my-notes.md'), 'keep me');
    await writeFile(join(tw.destination, 'references', 'GUIDE.md'), 'edited guide');
    await t.app.remove(tw.id, true, true);
    expect(await readdir(tw.destination)).toEqual(['my-notes.md']);
  });

  it('refuses receipts whose destination is outside a known root', async () => {
    t = await setupInstalled();
    const cr = receiptFor(t, 'code-review');
    const victim = join(t.home, 'Documents');
    await mkdir(victim, { recursive: true });
    await writeFile(join(victim, 'SKILL.md'), 'precious');
    await t.store.saveReceipt({ ...cr, destination: victim }, 'tampered');
    await expect(t.app.remove(cr.id, true, true)).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ROOT',
    });
    expect(await readFile(join(victim, 'SKILL.md'), 'utf8')).toBe('precious');
  });
});
