import { join } from 'node:path';
import { SkillScopeApp, SkillScopeStore, createPlatformContext } from '../src/index.js';
import { cleanup, tempDir } from './helpers.js';
import { REGISTRY, mockRegistry, type MockPackage } from './package-helpers.js';

export interface TestApp {
  app: SkillScopeApp;
  store: SkillScopeStore;
  home: string;
  data: string;
  workspace: string;
  requests: string[];
  dispose(): Promise<void>;
}

/** A SkillScopeApp with a fake home, workspace, data folder and mock registry. */
export async function createTestApp(
  packages: Record<string, MockPackage>,
  home?: string,
): Promise<TestApp> {
  const h = home ?? (await tempDir('skillscope-home-'));
  const data = await tempDir('skillscope-data-');
  const workspace = await tempDir('skillscope-ws-');
  const store = await SkillScopeStore.open(join(data, 'skillscope.db'));
  const reg = mockRegistry(packages);
  const app = new SkillScopeApp({
    store,
    dataDir: data,
    platform: createPlatformContext({ homeDir: h, env: {} }),
    fetch: reg.fetch,
  });
  const settings = app.settings();
  await app.updateSettings({
    registry: { ...settings.registry, url: REGISTRY, retries: 0 },
    scan: { ...settings.scan, includeSystemRoots: false },
    workspaceRoot: workspace,
  });
  return {
    app,
    store,
    home: h,
    data,
    workspace,
    requests: reg.requests,
    async dispose() {
      store.close();
      await cleanup(h, data, workspace);
    },
  };
}
