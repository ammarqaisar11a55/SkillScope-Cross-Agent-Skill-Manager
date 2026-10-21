import { lstat, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import type { InstallationReceipt, RemovalPreview } from '@skillscope/shared';
import { SkillScopeError } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import type { AdapterContext } from '../agents/types.js';
import { readSkillTree } from '../inventory/files.js';
import { isInside, pathKey } from '../platform/context.js';

/**
 * A receipt from the database is not trusted blindly: its destination must still be a direct
 * child of a root that one of its agents installs into, and must not be a symbolic link.
 */
export async function assertManagedDestination(
  ctx: AdapterContext,
  registry: AdapterRegistry,
  receipt: InstallationReceipt,
): Promise<void> {
  const p = ctx.platform.path;
  const roots = receipt.agentIds.flatMap((a) => registry.get(a).installRoots(ctx, receipt.scope));
  const root = roots.find(
    (r) => pathKey(ctx.platform, r.path) === pathKey(ctx.platform, receipt.rootPath),
  );
  const inside = isInside(ctx.platform, receipt.rootPath, receipt.destination, false);
  const direct =
    pathKey(ctx.platform, p.dirname(receipt.destination)) ===
    pathKey(ctx.platform, receipt.rootPath);
  if (!root || !inside || !direct) {
    throw new SkillScopeError(
      'PATH_OUTSIDE_ROOT',
      `${receipt.destination} is no longer inside a known installation root.`,
      {
        hint: 'If you changed the workspace or custom locations, switch back before removing this skill.',
      },
    );
  }
  const st = await lstat(receipt.destination).catch(() => null);
  if (st?.isSymbolicLink()) {
    throw new SkillScopeError(
      'PATH_OUTSIDE_ROOT',
      `${receipt.destination} is now a symbolic link; SkillScope will not follow it.`,
    );
  }
}

export async function previewRemoval(
  ctx: AdapterContext,
  receipt: InstallationReceipt,
): Promise<RemovalPreview> {
  const tree = await readSkillTree(receipt.destination, ctx.platform);
  const onDisk = new Map(
    tree.files.filter((f) => f.kind !== 'directory').map((f) => [f.path, f] as const),
  );
  const owned = new Map(receipt.files.map((f) => [f.path, f] as const));
  const filesToRemove: string[] = [];
  const modifiedFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const [path, f] of owned) {
    const current = onDisk.get(path);
    if (!current) missingFiles.push(path);
    else if (current.kind !== 'file' || current.sha256 !== f.sha256) modifiedFiles.push(path);
    else filesToRemove.push(path);
  }
  const unownedFiles = [...onDisk.keys()].filter((p) => !owned.has(p));
  return {
    receiptId: receipt.id,
    destination: receipt.destination,
    filesToRemove,
    modifiedFiles,
    unownedFiles,
    missingFiles,
  };
}

async function pruneEmptyDirs(
  dir: string,
  ctxPath: AdapterContext['platform']['path'],
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const child = ctxPath.join(dir, name);
    const st = await lstat(child).catch(() => null);
    if (st?.isDirectory()) await pruneEmptyDirs(child, ctxPath);
  }
  await rmdir(dir).catch(() => undefined);
}

/**
 * Delete only files SkillScope installed and that are unchanged (or, if allowed, modified).
 * Files the user added are always kept, and directories are removed only once empty.
 */
export async function removeManagedFiles(
  ctx: AdapterContext,
  receipt: InstallationReceipt,
  removeModified: boolean,
): Promise<{ removed: string[]; kept: string[]; destinationRemoved: boolean }> {
  const preview = await previewRemoval(ctx, receipt);
  const p = ctx.platform.path;
  const toRemove = removeModified
    ? [...preview.filesToRemove, ...preview.modifiedFiles]
    : preview.filesToRemove;
  const removed: string[] = [];
  for (const rel of toRemove) {
    const target = p.join(receipt.destination, ...rel.split('/'));
    if (!isInside(ctx.platform, receipt.destination, target, false)) continue;
    const st = await lstat(target).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) continue;
    await unlink(target);
    removed.push(rel);
  }
  await pruneEmptyDirs(receipt.destination, p);
  const destinationRemoved = !(await lstat(receipt.destination).then(
    () => true,
    () => false,
  ));
  const kept = [...preview.unownedFiles, ...(removeModified ? [] : preview.modifiedFiles)];
  return { removed, kept, destinationRemoved };
}

export async function removeBackup(path: string | null): Promise<void> {
  if (path) await rm(path, { recursive: true, force: true });
}
