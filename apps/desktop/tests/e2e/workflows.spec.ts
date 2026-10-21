import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { goTo, launchApp, type LaunchedApp } from './launch.js';

const FIXTURE_HOME = resolve(import.meta.dirname, '../../../../fixtures/home/basic');

let home: string;
let launched: LaunchedApp;

test.beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'skillscope-e2e-fixture-'));
  await cp(FIXTURE_HOME, home, { recursive: true });
  launched = await launchApp({ home });
});

test.afterEach(async () => {
  await launched.close();
  await rm(home, { recursive: true, force: true });
});

test('dashboard shows counts derived from the real scan', async () => {
  const { page } = launched;
  await expect(page.getByTestId('stat-unique-skills')).toHaveText('7');
  await expect(page.getByTestId('stat-availability')).toHaveText('12');
  await expect(page.getByTestId('agent-count-claude')).toHaveText('4 skills');
  await expect(page.getByTestId('agent-count-codex')).toHaveText('1 skill');
  await expect(page.getByTestId('agent-count-cursor')).toHaveText('7 skills');
  await expect(page.getByText('does not prove that an agent has loaded')).toBeVisible();
});

test('inventory search, filters and skill details work', async () => {
  const { page } = launched;
  await goTo(page, 'Skills');
  const table = page.getByTestId('inventory-table');
  await expect(table.locator('tbody tr')).toHaveCount(7);
  await page.getByLabel('Search skills').fill('pdf');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'pdf-tools' }).click();
  await expect(page.getByRole('dialog')).toContainText('Why agents can see it');
  await expect(page.getByRole('dialog')).toContainText('compatibility location');
  await page.getByRole('button', { name: 'scripts/extract.py' }).click();
  await expect(page.getByRole('dialog')).toContainText('def main');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Search skills').fill('');
  await page.getByLabel('Agent', { exact: true }).selectOption('codex');
  await expect(table.locator('tbody tr')).toHaveCount(1);
});

test('agent explorer explains roots and the validation center lists problems', async () => {
  const { page } = launched;
  await goTo(page, 'Agents');
  await page.getByRole('tab', { name: /Cursor/ }).click();
  await expect(
    page.getByText('Claude Code skills (~/.claude/skills)', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Why: Cursor also reads/).first()).toBeVisible();
  await goTo(page, 'Validation');
  await expect(page.getByText('The directory has no SKILL.md file').first()).toBeVisible();
  await expect(page.getByText('Identical content')).toBeVisible();
});

test('theme preference persists across restarts', async () => {
  const { page } = launched;
  await goTo(page, 'Settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await launched.app.close();
  launched = await launchApp({ home, dataDir: launched.dataDir });
  await expect(launched.page.locator('html')).toHaveClass(/dark/);
  await goTo(launched.page, 'Settings');
  await launched.page.getByRole('radio', { name: 'Light' }).click();
  await expect(launched.page.locator('html')).not.toHaveClass(/dark/);
});

test('shows the GitHub repository button and opens it outside the app', async () => {
  const { page, app } = launched;
  const link = page.getByTestId('github-repo-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    'href',
    'https://github.com/ammarqaisar11a55/SkillScope-Cross-Agent-Skill-Manager',
  );
  // Stub shell.openExternal so the test does not launch a real browser.
  await app.evaluate(({ shell }) => {
    (globalThis as { __opened?: string[] }).__opened = [];
    shell.openExternal = async (url: string) => {
      (globalThis as { __opened?: string[] }).__opened?.push(url);
    };
  });
  await link.click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []))
    .toEqual(['https://github.com/ammarqaisar11a55/SkillScope-Cross-Agent-Skill-Manager']);
  expect(app.windows()).toHaveLength(1);
});

test('marketplace respects offline mode', async () => {
  const { page } = launched;
  await goTo(page, 'Marketplace');
  await page.getByLabel('Search npm').fill('review');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('Network access is turned off.')).toBeVisible();
});
