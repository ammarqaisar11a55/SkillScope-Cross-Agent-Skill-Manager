import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app-helpers.js';
import { canSymlink, cleanup, tempDir } from './helpers.js';
import { tarFixture } from './package-helpers.js';

/**
 * Regression test for Windows CI: the runner's home/temp path is an 8.3 short name
 * (C:\Users\RUNNER~1\...) while realpath() returns the long name, so receipts recorded under one
 * spelling were not matched to skills discovered under the other. A home folder reached through a
 * symlink reproduces the same mismatch on Linux.
 */
describe('managed skills under an aliased home folder', () => {
  let t: TestApp | undefined;
  let realHome: string | undefined;
  let parent: string | undefined;
  afterEach(async () => {
    await t?.dispose();
    if (realHome) await cleanup(realHome);
    if (parent) await cleanup(parent);
  });

  it('recognises installed skills when the home path is not canonical', async ({ skip }) => {
    if (!(await canSymlink())) skip();
    realHome = await tempDir('skillscope-real-home-');
    parent = await tempDir('skillscope-alias-');
    const aliasHome = join(parent, 'home');
    await symlink(realHome, aliasHome, 'dir');

    t = await createTestApp(
      {
        '@acme/agent-skills': {
          versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } },
        },
      },
      aliasHome,
    );
    const inspection = await t.app.inspectPackage('@acme/agent-skills', '1.0.0');
    const plan = await t.app.planInstall({
      stagingId: inspection.stagingId,
      skills: ['code-review'],
      targets: [{ agentId: 'claude', scope: 'global' }],
      allowSharedInstall: false,
    });
    const result = await t.app.executeInstall(plan.id, 'abort', true);
    const destination = result.receipts[0]?.destination ?? '';
    expect(destination.startsWith(aliasHome)).toBe(true);

    let skill = t.app.cachedInventory()?.skills.find((s) => s.name === 'code-review');
    expect(skill?.realPath.startsWith(aliasHome)).toBe(false);
    expect(skill?.management).toBe('managed');
    expect(skill?.package?.name).toBe('@acme/agent-skills');

    await writeFile(join(destination, 'notes.md'), 'local change');
    skill = (await t.app.scan()).skills.find((s) => s.name === 'code-review');
    expect(skill?.management).toBe('modified');
  });
});
