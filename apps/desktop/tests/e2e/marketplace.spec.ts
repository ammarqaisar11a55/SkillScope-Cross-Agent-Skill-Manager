import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { mockRegistry, tarFixture } from '../../../../packages/core/tests/package-helpers.js';
import { goTo, launchApp, type LaunchedApp } from './launch.js';

let server: Server;
let base: string;
let launched: LaunchedApp;

test.beforeEach(async () => {
  // A local stand-in for registry.npmjs.org; SkillScope allows plain http only for localhost.
  server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const registry = mockRegistry(
    {
      '@acme/agent-skills': {
        versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } },
        keywords: ['agent-skill', 'claude-code-skill', 'codex-skill', 'cursor-skill'],
      },
    },
    base,
  );
  server.on('request', (req, res) => {
    void registry.fetch(`${base}${req.url ?? '/'}`).then(async (r) => {
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
      });
      res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
  launched = await launchApp({ env: { SKILLSCOPE_OFFLINE: '0' } });
  const settings = await launched.page.evaluate(async () => {
    const r = await window.skillscope.invoke('settings:get');
    return r.ok ? r.value : null;
  });
  await launched.page.evaluate(
    async ({ url, registry }) => {
      await window.skillscope.invoke('settings:update', {
        registry: { ...registry, url, retries: 0 },
      });
    },
    { url: base, registry: settings?.registry ?? { url: base, timeoutMs: 15000, retries: 0 } },
  );
});

test.afterEach(async () => {
  await launched.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('search, inspect and install a package independently for two agents', async () => {
  const { page, home } = launched;
  await goTo(page, 'Marketplace');
  await page.getByLabel('Search npm').fill('review');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: /@acme\/agent-skills/ }).click();
  await page.getByRole('button', { name: 'Inspect package' }).click();
  await expect(page.getByText('Integrity verified (sha512)')).toBeVisible();
  await expect(page.getByText(/declares lifecycle scripts \(postinstall\)/)).toBeVisible();

  await page.getByTestId('target-codex').uncheck();
  await page.getByRole('checkbox', { name: 'test-writer' }).uncheck();
  await page.getByRole('button', { name: 'Review installation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(join(home, '.claude', 'skills', 'code-review'));
  await expect(dialog).toContainText(join(home, '.cursor', 'skills', 'code-review'));
  await expect(page.getByTestId('confirm-install')).toBeDisabled();
  await page.getByTestId('confirm-checkbox').check();
  await page.getByTestId('confirm-install').click();
  await expect(dialog).toContainText('Installed 2 skill copies');

  expect(
    await readFile(join(home, '.claude', 'skills', 'code-review', 'SKILL.md'), 'utf8'),
  ).toContain('name: code-review');
  expect((await stat(join(home, '.cursor', 'skills', 'code-review'))).isDirectory()).toBe(true);
  await expect(stat(join(home, '.agents', 'skills', 'code-review'))).rejects.toThrow();

  await page.getByRole('button', { name: 'Done' }).click();
  await goTo(page, 'Installations');
  await expect(page.getByText('Installed to', { exact: true })).toHaveCount(2);
});
