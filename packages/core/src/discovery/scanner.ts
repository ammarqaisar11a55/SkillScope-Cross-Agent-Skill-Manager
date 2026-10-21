import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { pathKey, type PlatformContext } from '../platform/context.js';

export const SKILL_FILE_NAME = 'SKILL.md';

/** Directories never descended into: dependency folders and caches. Hidden folders are skipped too. */
export const SKIPPED_DIRECTORIES = new Set(['node_modules', '__pycache__', 'bower_components']);

/** Hard cap on directory entries examined per root, so a misconfigured root cannot stall a scan. */
export const MAX_ENTRIES_PER_ROOT = 10_000;

export interface DiscoveredSkillDir {
  /** Directory as reached from the root (may contain symlinked segments). */
  dir: string;
  /** Canonical directory after resolving symlinks. */
  realDir: string;
  /** 1 for `<root>/<skill>`, 2 for `<root>/<category>/<skill>`, ... */
  depth: number;
  isSymlink: boolean;
  /** Absolute path of SKILL.md, or null when the directory has no skill file. */
  skillFile: string | null;
  /** Actual file name found (differs from SKILL.md when the case is wrong). */
  skillFileName: string | null;
}

export interface PathScanResult {
  path: string;
  exists: boolean;
  readable: boolean;
  error: string | null;
  skills: DiscoveredSkillDir[];
  warnings: string[];
}

export interface ScanOptions {
  ctx: PlatformContext;
  maxDepth: number;
  followSymlinks: boolean;
  /** Keys (see pathKey) of other skill roots; such folders are never reported as broken skills. */
  knownRootKeys?: ReadonlySet<string>;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
    if (code === 'ENOENT') return 'does not exist';
    if (code === 'ENOTDIR') return 'not a directory';
    if (code === 'ELOOP') return 'too many symbolic links';
    return code;
  }
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : null;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Read-only scan of one skill root. Uses only lstat/stat/readdir/realpath: it never creates,
 * modifies or opens files for writing, and never creates a missing root.
 */
export async function scanPath(root: string, options: ScanOptions): Promise<PathScanResult> {
  const result: PathScanResult = {
    path: root,
    exists: false,
    readable: false,
    error: null,
    skills: [],
    warnings: [],
  };
  let rootStats: Stats;
  try {
    rootStats = await stat(root);
  } catch (error) {
    if (isMissing(error)) return result;
    result.exists = true;
    result.error = errorMessage(error);
    return result;
  }
  result.exists = true;
  if (!rootStats.isDirectory()) {
    result.error = 'not a directory';
    return result;
  }

  const visited = new Set<string>();
  let budget = MAX_ENTRIES_PER_ROOT;
  try {
    visited.add(pathKey(options.ctx, await realpath(root)));
    await readdir(root);
    result.readable = true;
  } catch (error) {
    result.error = errorMessage(error);
    return result;
  }

  const p = options.ctx.path;

  /** Returns true when at least one skill directory was found at or below `dir`. */
  async function walk(dir: string, depth: number, viaSymlink: boolean): Promise<boolean> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      result.warnings.push(`Cannot read ${dir}: ${errorMessage(error)}`);
      return false;
    }
    let found = false;
    for (const entry of entries) {
      if (budget-- <= 0) {
        result.warnings.push(`Stopped after ${MAX_ENTRIES_PER_ROOT} entries in ${root}.`);
        return found;
      }
      if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const child = p.join(dir, entry.name);
      let isDir = entry.isDirectory();
      const isLink = entry.isSymbolicLink();
      if (isLink) {
        if (!options.followSymlinks) {
          result.warnings.push(`Skipped symbolic link ${child} (following symlinks is disabled).`);
          continue;
        }
        try {
          isDir = (await stat(child)).isDirectory();
        } catch (error) {
          result.warnings.push(`Broken symbolic link ${child}: ${errorMessage(error)}`);
          continue;
        }
      }
      if (!isDir) continue;
      if (await examine(child, depth + 1, viaSymlink || isLink)) found = true;
    }
    return found;
  }

  async function examine(dir: string, depth: number, viaSymlink: boolean): Promise<boolean> {
    let real: string;
    try {
      real = await realpath(dir);
    } catch (error) {
      result.warnings.push(`Cannot resolve ${dir}: ${errorMessage(error)}`);
      return false;
    }
    const realKey = pathKey(options.ctx, real);
    if (visited.has(realKey)) {
      result.warnings.push(`Skipped ${dir}: already visited (symlink cycle or duplicate link).`);
      return false;
    }
    visited.add(realKey);

    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      result.warnings.push(`Cannot read ${dir}: ${errorMessage(error)}`);
      return false;
    }
    const skillFileName =
      names.find((n) => n === SKILL_FILE_NAME) ??
      names.find((n) => n.toLowerCase() === 'skill.md') ??
      null;
    let isSymlink = viaSymlink;
    try {
      isSymlink = isSymlink || (await lstat(dir)).isSymbolicLink();
    } catch {
      // lstat failure is already covered by the readdir above.
    }

    if (skillFileName) {
      result.skills.push({
        dir,
        realDir: real,
        depth,
        isSymlink,
        skillFile: p.join(dir, skillFileName),
        skillFileName,
      });
      return true;
    }

    const isKnownRoot = options.knownRootKeys?.has(pathKey(options.ctx, dir)) ?? false;
    let foundBelow = false;
    if (depth < options.maxDepth) {
      foundBelow = await walk(dir, depth, isSymlink);
    }
    if (!foundBelow && !isKnownRoot) {
      // A folder inside a skills root with no SKILL.md anywhere below it is a broken skill.
      result.skills.push({
        dir,
        realDir: real,
        depth,
        isSymlink,
        skillFile: null,
        skillFileName: null,
      });
    }
    return foundBelow;
  }

  await walk(root, 0, false);
  return result;
}
