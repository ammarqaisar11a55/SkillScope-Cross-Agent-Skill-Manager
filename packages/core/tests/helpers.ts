import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CustomSkillLocation } from '@skillscope/shared';
import type { AdapterContext } from '../src/agents/types.js';
import { createPlatformContext } from '../src/platform/context.js';

export const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

export async function tempDir(prefix = 'skillscope-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Copy a fixture tree into a fresh temporary directory and return its path. */
export async function copyFixture(relative: string): Promise<string> {
  const dir = await tempDir();
  await cp(join(FIXTURES, relative), dir, { recursive: true });
  return dir;
}

export async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
}

export function adapterContext(
  home: string,
  workspaceRoot: string | null = null,
  extra: Partial<AdapterContext> & { env?: Record<string, string> } = {},
): AdapterContext {
  return {
    platform: createPlatformContext({ homeDir: home, env: extra.env ?? {} }),
    workspaceRoot,
    includeSystemRoots: extra.includeSystemRoots ?? false,
    maxDepth: extra.maxDepth ?? 4,
    customLocations: extra.customLocations ?? ([] as CustomSkillLocation[]),
  };
}

/** Snapshot of every path with its mtime, used to prove a scan did not modify anything. */
export async function treeSnapshot(dir: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = join(d, e.name);
      out[p] = (await stat(p)).mtimeMs;
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(dir);
  return out;
}

export const canSymlink = async (): Promise<boolean> => {
  const { symlink } = await import('node:fs/promises');
  const dir = await tempDir();
  try {
    await symlink(dir, join(dir, 'probe'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    await cleanup(dir);
  }
};

export const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
