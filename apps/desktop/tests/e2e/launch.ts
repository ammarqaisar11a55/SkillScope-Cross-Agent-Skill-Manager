import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  home: string;
  dataDir: string;
  close(): Promise<void>;
}

/**
 * Launch the built app against an isolated fake home directory and data directory, so tests
 * never read or modify the real user's agent installations.
 */
export async function launchApp(
  options: { home?: string; dataDir?: string; env?: Record<string, string> } = {},
): Promise<LaunchedApp> {
  const home = options.home ?? (await mkdtemp(join(tmpdir(), 'skillscope-e2e-home-')));
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'skillscope-e2e-data-')));
  // Launch the app folder (not out/main) so Electron reads package.json for name and version.
  const args = [join(import.meta.dirname, '../..')];
  // CI containers and some Linux filesystems cannot run Chromium's setuid sandbox helper.
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await electron.launch({
    args,
    env: {
      ...process.env,
      SKILLSCOPE_HOME_OVERRIDE: home,
      SKILLSCOPE_DATA_DIR: dataDir,
      SKILLSCOPE_OFFLINE: '1',
      ...options.env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
    home,
    dataDir,
    async close() {
      await app.close().catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true });
      if (!options.home) await rm(home, { recursive: true, force: true });
    },
  };
}

/** Click a sidebar navigation item (scoped so page content with similar names never matches). */
export async function goTo(page: Page, label: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: label, exact: true })
    .click();
}
