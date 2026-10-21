import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { SkillScopeError } from '@skillscope/shared';
import { isInside, type PlatformContext } from '../platform/context.js';
import type { ArchiveFile } from './tarball.js';

export const STAGING_DIR_NAME = 'staging';
export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STAGING_ID = /^stg_[0-9a-f]{32}$/;

export function stagingRoot(ctx: PlatformContext, dataDir: string): string {
  return ctx.path.join(dataDir, STAGING_DIR_NAME);
}

export function stagingDir(ctx: PlatformContext, dataDir: string, stagingId: string): string {
  if (!STAGING_ID.test(stagingId))
    throw new SkillScopeError('INVALID_REQUEST', 'Invalid staging id.');
  return ctx.path.join(stagingRoot(ctx, dataDir), stagingId);
}

/**
 * Write validated archive entries into a fresh directory under SkillScope's own data folder.
 * Every target path is re-checked to be inside that directory; files are created exclusively and
 * never with setuid/setgid bits.
 */
export async function stageFiles(
  ctx: PlatformContext,
  dataDir: string,
  files: ArchiveFile[],
): Promise<{ stagingId: string; dir: string }> {
  const stagingId = `stg_${randomUUID().replace(/-/g, '')}`;
  const dir = stagingDir(ctx, dataDir, stagingId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    for (const file of files) {
      const target = ctx.path.join(dir, ...file.path.split('/'));
      if (!isInside(ctx, dir, target, false)) {
        throw new SkillScopeError(
          'UNSAFE_ARCHIVE',
          `Refusing to write "${file.path}" outside the staging folder.`,
        );
      }
      await mkdir(ctx.path.dirname(target), { recursive: true });
      await writeFile(target, file.data, { flag: 'wx', mode: file.executable ? 0o755 : 0o644 });
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { stagingId, dir };
}

export async function discardStaging(
  ctx: PlatformContext,
  dataDir: string,
  stagingId: string,
): Promise<void> {
  await rm(stagingDir(ctx, dataDir, stagingId), { recursive: true, force: true });
}

/** Remove staging folders left behind by earlier sessions. */
export async function pruneStaging(
  ctx: PlatformContext,
  dataDir: string,
  now = Date.now(),
): Promise<number> {
  const root = stagingRoot(ctx, dataDir);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!STAGING_ID.test(name)) continue;
    const dir = ctx.path.join(root, name);
    const st = await stat(dir).catch(() => null);
    if (st && now - st.mtimeMs > STAGING_MAX_AGE_MS) {
      await rm(dir, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}
