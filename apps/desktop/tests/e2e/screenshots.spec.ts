import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from '@playwright/test';
import { goTo, launchApp } from './launch.js';

// Regenerates docs/screenshots from fixture data: SKILLSCOPE_SCREENSHOTS=1 npx playwright test screenshots
test.skip(
  !process.env.SKILLSCOPE_SCREENSHOTS,
  'set SKILLSCOPE_SCREENSHOTS=1 to regenerate documentation screenshots',
);

const ROOT = resolve(import.meta.dirname, '../../../..');
const OUT = join(ROOT, 'docs', 'screenshots');

test('capture documentation screenshots', async () => {
  test.setTimeout(120_000);
  const home = await mkdtemp(join(tmpdir(), 'skillscope-shots-'));
  const workspace = await mkdtemp(join(tmpdir(), 'skillscope-shots-ws-'));
  await cp(join(ROOT, 'fixtures', 'home', 'basic'), home, { recursive: true });
  await cp(join(ROOT, 'fixtures', 'workspace', 'basic'), workspace, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const launched = await launchApp({ home });
  try {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1360, 880));
    await page.evaluate(async (ws) => {
      await window.skillscope.invoke('settings:update', { workspaceRoot: ws });
      await window.skillscope.invoke('inventory:scan');
    }, workspace);
    await page.reload();
    await page.getByTestId('stat-unique-skills').waitFor();
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(async (t) => {
        await window.skillscope.invoke('settings:update', { theme: t });
      }, theme);
      await page.reload();
      await page.getByTestId('stat-unique-skills').waitFor();
      await page.waitForTimeout(1000); // let the reach map finish drawing
      await page.screenshot({ path: join(OUT, `dashboard-${theme}.png`) });
      await goTo(page, 'Skills');
      await page.getByTestId('inventory-table').waitFor();
      await page.screenshot({ path: join(OUT, `inventory-${theme}.png`) });
      if (theme === 'light') {
        await goTo(page, 'Agents');
        await page.getByRole('tab', { name: /Cursor/ }).click();
        await page.screenshot({ path: join(OUT, 'agents-light.png') });
        await goTo(page, 'Validation');
        await page.screenshot({ path: join(OUT, 'validation-light.png') });
        await goTo(page, 'Settings');
        await page.screenshot({ path: join(OUT, 'settings-light.png') });
      }
      await goTo(page, 'Dashboard');
    }
  } finally {
    await launched.close();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});
