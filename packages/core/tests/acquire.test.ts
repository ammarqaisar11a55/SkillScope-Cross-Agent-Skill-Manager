import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app-helpers.js';
import { buildTarball, sri, tarFixture } from './package-helpers.js';

async function listAll(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      out.push(p);
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(dir);
  return out;
}

describe('secure package acquisition', () => {
  let t: TestApp;
  afterEach(async () => t?.dispose());

  it('downloads, verifies, stages and validates a multi-skill package', async () => {
    t = await createTestApp({
      '@acme/agent-skills': { versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } } },
    });
    const inspection = await t.app.inspectPackage('@acme/agent-skills', '1.0.0');
    expect(inspection.installable).toBe(true);
    expect(inspection.integrity).toMatchObject({ algorithm: 'sha512', verified: true });
    expect(inspection.manifestSource).toBe('agent-skill.json');
    expect(inspection.skills.map((s) => [s.name, s.declaredAgents])).toEqual([
      ['code-review', ['claude', 'codex', 'cursor']],
      ['test-writer', ['claude', 'cursor']],
    ]);
    expect(inspection.skills.every((s) => s.validation.state === 'valid')).toBe(true);
    expect(inspection.files).toContain('docs/README.md');
  });

  it('records lifecycle scripts but never runs them', async () => {
    t = await createTestApp({
      '@acme/agent-skills': { versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } } },
    });
    const inspection = await t.app.inspectPackage('@acme/agent-skills', '1.0.0');
    expect(inspection.lifecycleScripts).toEqual(['postinstall']);
    expect(inspection.issues.map((i) => i.code)).toContain('package.lifecycle-scripts');
    const all = [
      ...(await listAll(t.data)),
      ...(await listAll(t.home)),
      ...(await listAll(process.cwd())),
    ];
    expect(all.some((p) => p.endsWith('POSTINSTALL_RAN'))).toBe(false);
  });

  it('rejects an integrity mismatch before anything is staged', async () => {
    const tgz = await tarFixture('multi-skill');
    t = await createTestApp({
      evil: { versions: { '1.0.0': { tarball: tgz, integrity: sri(Buffer.from('different')) } } },
    });
    await expect(t.app.inspectPackage('evil', '1.0.0')).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    });
    expect(await listAll(join(t.data, 'staging'))).toEqual([]);
    expect(t.store.listOperations()[0]).toMatchObject({ state: 'failed', packageName: 'evil' });
  });

  it('rejects a version without integrity metadata', async () => {
    t = await createTestApp({
      nometa: {
        versions: { '1.0.0': { tarball: await tarFixture('multi-skill'), integrity: null } },
      },
    });
    const inspection = await t.app.inspectPackage('nometa', '1.0.0');
    expect(inspection.installable).toBe(false);
    expect(inspection.issues.map((i) => i.code)).toContain('package.integrity-missing');
  });

  it('rejects malicious archives without writing outside the staging folder', async () => {
    const tgz = await buildTarball([
      { name: 'package/package.json', content: '{}' },
      { name: 'package/../../../escaped.txt', content: 'pwned' },
    ]);
    t = await createTestApp({ malicious: { versions: { '1.0.0': { tarball: tgz } } } });
    const before = await listAll(t.home);
    await expect(t.app.inspectPackage('malicious', '1.0.0')).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
    expect(await listAll(t.home)).toEqual(before);
    expect(await listAll(join(t.data, 'staging'))).toEqual([]);
    const parent = join(t.data, '..');
    expect((await readdir(parent)).includes('escaped.txt')).toBe(false);
  });

  it('distinguishes valid, invalid and unrelated packages', async () => {
    t = await createTestApp({
      unrelated: { versions: { '1.0.0': { tarball: await tarFixture('unrelated') } } },
      broken: { versions: { '1.0.0': { tarball: await tarFixture('invalid-manifest') } } },
      ambiguous: { versions: { '1.0.0': { tarball: await tarFixture('ambiguous') } } },
      fallback: { versions: { '0.2.0': { tarball: await tarFixture('fallback-layout') } } },
    });
    const unrelated = await t.app.inspectPackage('unrelated', '1.0.0');
    expect(unrelated.installable).toBe(false);
    expect(unrelated.issues.map((i) => i.code)).toContain('package.not-a-skill-package');

    const broken = await t.app.inspectPackage('broken', '1.0.0');
    expect(broken.installable).toBe(false);
    expect(
      broken.issues.filter((i) => i.code === 'package.manifest-invalid').length,
    ).toBeGreaterThan(0);

    const ambiguous = await t.app.inspectPackage('ambiguous', '1.0.0');
    expect(ambiguous.installable).toBe(false);
    expect(ambiguous.issues.map((i) => i.code)).toContain('package.ambiguous-layout');

    const fallback = await t.app.inspectPackage('fallback', '0.2.0');
    expect(fallback.installable).toBe(true);
    expect(fallback.manifestSource).toBe('none');
    expect(fallback.skills.map((s) => s.name)).toEqual(['lint-helper']);
    expect(fallback.issues.map((i) => i.code)).toContain('package.manifest-missing');
  });

  it('discards staged packages', async () => {
    t = await createTestApp({
      '@acme/agent-skills': { versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } } },
    });
    const inspection = await t.app.inspectPackage('@acme/agent-skills', '1.0.0');
    const dir = join(t.data, 'staging', inspection.stagingId);
    expect((await stat(dir)).isDirectory()).toBe(true);
    await t.app.discardPackage(inspection.stagingId);
    await expect(stat(dir)).rejects.toThrow();
  });
});
