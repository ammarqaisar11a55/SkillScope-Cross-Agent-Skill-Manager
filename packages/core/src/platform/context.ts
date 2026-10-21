import os from 'node:os';
import path from 'node:path';

export type SupportedPlatform = 'linux' | 'win32' | 'darwin';

/**
 * Everything platform-specific that path logic needs. Passing it explicitly lets tests resolve
 * Windows paths on Linux (and vice versa) without touching the real environment.
 */
export interface PlatformContext {
  platform: SupportedPlatform;
  homeDir: string;
  env: Readonly<Record<string, string | undefined>>;
  path: path.PlatformPath;
  /** Windows and default macOS filesystems compare paths case-insensitively. */
  caseInsensitive: boolean;
}

export function toSupportedPlatform(platform: string): SupportedPlatform {
  if (platform === 'win32' || platform === 'darwin') return platform;
  return 'linux';
}

export function createPlatformContext(
  overrides: Partial<Omit<PlatformContext, 'path' | 'caseInsensitive'>> = {},
): PlatformContext {
  const platform = overrides.platform ?? toSupportedPlatform(process.platform);
  const p = platform === 'win32' ? path.win32 : path.posix;
  return {
    platform,
    homeDir: overrides.homeDir ?? os.homedir(),
    env: overrides.env ?? process.env,
    path: p,
    caseInsensitive: platform !== 'linux',
  };
}

/** Comparable key for a path: normalised, without trailing separators, case-folded if needed. */
export function pathKey(ctx: PlatformContext, input: string): string {
  let normalized = ctx.path.normalize(ctx.path.resolve(input));
  const root = ctx.path.parse(normalized).root;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return ctx.caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function samePath(ctx: PlatformContext, a: string, b: string): boolean {
  return pathKey(ctx, a) === pathKey(ctx, b);
}

/** True when `child` is `parent` itself or lies inside it (no `..` escape, same drive). */
export function isInside(
  ctx: PlatformContext,
  parent: string,
  child: string,
  allowEqual = true,
): boolean {
  const rel = ctx.path.relative(pathKey(ctx, parent), pathKey(ctx, child));
  if (rel === '') return allowEqual;
  return !rel.startsWith('..') && !ctx.path.isAbsolute(rel);
}

/** Relative path from `from` to `to` using forward slashes, for storage and display. */
export function toPosixRelative(ctx: PlatformContext, from: string, to: string): string {
  return ctx.path.relative(from, to).split(ctx.path.sep).join('/');
}

/** Expand a leading `~` and environment variables such as `%APPDATA%` or `$HOME`. */
export function expandUserPath(ctx: PlatformContext, input: string): string {
  let out = input.trim();
  if (out === '~') out = ctx.homeDir;
  else if (out.startsWith('~/') || out.startsWith('~\\'))
    out = ctx.path.join(ctx.homeDir, out.slice(2));
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name: string) => ctx.env[name] ?? m);
  out = out.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name: string) =>
    name === 'HOME' ? ctx.homeDir : (ctx.env[name] ?? m),
  );
  return ctx.path.normalize(out);
}

/** Windows MAX_PATH without long-path support. Used to warn before an install fails. */
export const WINDOWS_MAX_PATH = 260;

export function exceedsPathLimit(ctx: PlatformContext, target: string): boolean {
  return ctx.platform === 'win32' && target.length >= WINDOWS_MAX_PATH;
}
