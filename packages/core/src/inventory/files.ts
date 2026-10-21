import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import type { FileKind, SkillFileEntry } from '@skillscope/shared';
import type { PlatformContext } from '../platform/context.js';

export const MAX_SKILL_FILES = 2_000;
export const MAX_SKILL_BYTES = 64 * 1024 * 1024;

export interface SkillTreeFile extends SkillFileEntry {
  /** sha256 of the file content, or of the link target for symlinks. */
  sha256: string | null;
  /** Link target for symlinks (not followed). */
  linkTarget?: string;
}

export interface SkillTree {
  files: SkillTreeFile[];
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  latestMtimeMs: number;
  truncated: boolean;
  errors: string[];
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

/** Combine per-file hashes into one order-independent content hash for the directory. */
export function combineHashes(
  entries: { path: string; sha256: string | null; kind: FileKind }[],
): string {
  const lines = entries
    .filter((e) => e.kind !== 'directory')
    .map((e) => `${e.kind}\0${e.path}\0${e.sha256 ?? ''}`)
    .sort();
  return sha256Hex(lines.join('\n'));
}

/**
 * List and hash every file in a skill directory without following symlinks. Symlinks are
 * recorded (with their target) but never traversed, so a link cannot pull in outside content.
 */
export async function readSkillTree(dir: string, ctx: PlatformContext): Promise<SkillTree> {
  const files: SkillTreeFile[] = [];
  const errors: string[] = [];
  let totalBytes = 0;
  let latest = 0;
  let truncated = false;

  async function walk(abs: string, rel: string): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(abs)).sort();
    } catch (error) {
      errors.push(`Cannot read ${rel || '.'}: ${(error as Error).message}`);
      return;
    }
    for (const name of names) {
      if (files.length >= MAX_SKILL_FILES || totalBytes > MAX_SKILL_BYTES) {
        truncated = true;
        return;
      }
      const childAbs = ctx.path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try {
        st = await lstat(childAbs);
      } catch (error) {
        errors.push(`Cannot stat ${childRel}: ${(error as Error).message}`);
        continue;
      }
      latest = Math.max(latest, st.mtimeMs);
      if (st.isSymbolicLink()) {
        let target = '';
        try {
          target = await readlink(childAbs);
        } catch {
          // Unreadable link targets still count as a symlink entry.
        }
        files.push({
          path: childRel,
          size: 0,
          kind: 'symlink',
          sha256: sha256Hex(target),
          linkTarget: target,
        });
      } else if (st.isDirectory()) {
        files.push({ path: childRel, size: 0, kind: 'directory', sha256: null });
        await walk(childAbs, childRel);
      } else if (st.isFile()) {
        totalBytes += st.size;
        let digest: string | null = null;
        try {
          digest = await hashFile(childAbs);
        } catch (error) {
          errors.push(`Cannot read ${childRel}: ${(error as Error).message}`);
        }
        files.push({ path: childRel, size: st.size, kind: 'file', sha256: digest });
      } else {
        files.push({ path: childRel, size: 0, kind: 'other', sha256: null });
      }
    }
  }

  try {
    latest = (await lstat(dir)).mtimeMs;
  } catch {
    // The caller reports missing directories.
  }
  await walk(dir, '');
  return {
    files,
    contentHash: combineHashes(files),
    fileCount: files.filter((f) => f.kind !== 'directory').length,
    totalBytes,
    latestMtimeMs: latest,
    truncated,
    errors,
  };
}
