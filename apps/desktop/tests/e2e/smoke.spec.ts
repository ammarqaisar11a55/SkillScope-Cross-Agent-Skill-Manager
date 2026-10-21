import { expect, test } from '@playwright/test';
import { launchApp } from './launch.js';

test('application starts with a locked-down renderer', async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page).toHaveTitle('SkillScope');

    // Node.js and Electron internals must not be reachable from the renderer.
    const exposure = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      bridge: typeof window.skillscope?.invoke,
    }));
    expect(exposure).toEqual({ require: 'undefined', process: 'undefined', bridge: 'function' });

    // Unknown channels are refused by the preload bridge.
    const refused = await page.evaluate(() =>
      (window.skillscope.invoke as unknown as (c: string) => Promise<{ ok: boolean }>)(
        'fs:readFile',
      ),
    );
    expect(refused.ok).toBe(false);
  } finally {
    await launched.close();
  }
});
