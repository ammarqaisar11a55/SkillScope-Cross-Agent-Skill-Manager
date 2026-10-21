import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillScopeApp } from '@skillscope/core';
import { createHandlers, type DesktopBridge } from '../../src/main/handlers.js';

const event = {} as never;

function bridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    appInfo: () => ({
      version: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      electron: '44',
      dataDirectory: '/d',
    }),
    selectDirectory: vi.fn(async () => '/picked'),
    saveFile: vi.fn(async () => null),
    revealInFileManager: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('desktop IPC handlers', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skillscope-handlers-'));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('reveals only directories that come from the inventory', async () => {
    const app = {
      skillDirectory: vi.fn(async (id: string) => `/skills/${id}`),
    } as unknown as SkillScopeApp;
    const b = bridge();
    await createHandlers(app, b)['inventory:reveal']({ skillId: 'sk_1' }, event);
    expect(app.skillDirectory).toHaveBeenCalledWith('sk_1');
    expect(b.revealInFileManager).toHaveBeenCalledWith('/skills/sk_1');
  });

  it('writes exports to the path the user chose and returns null when cancelled', async () => {
    const app = {
      exportInventory: vi.fn(async () => '{"schema":"x"}'),
    } as unknown as SkillScopeApp;
    const target = join(dir, 'out.json');
    const chosen = createHandlers(app, bridge({ saveFile: async () => target }));
    expect(await chosen['export:inventory']({ format: 'json' }, event)).toBe(target);
    expect(await readFile(target, 'utf8')).toBe('{"schema":"x"}');
    const cancelled = createHandlers(app, bridge());
    expect(await cancelled['export:inventory']({ format: 'csv' }, event)).toBeNull();
  });

  it('passes confirmation flags through to the service unchanged', async () => {
    const app = {
      executeInstall: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({})),
    } as unknown as SkillScopeApp;
    const h = createHandlers(app, bridge());
    await h['install:execute'](
      { planId: 'plan_1', conflictPolicy: 'abort', confirmed: false },
      event,
    );
    expect(app.executeInstall).toHaveBeenCalledWith('plan_1', 'abort', false);
    await h['removal:execute']({ receiptId: 'r', removeModified: false, confirmed: true }, event);
    expect(app.remove).toHaveBeenCalledWith('r', false, true);
  });
});
