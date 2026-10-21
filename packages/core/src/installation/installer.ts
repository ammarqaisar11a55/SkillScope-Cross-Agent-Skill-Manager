import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import type {
  ConflictPolicy,
  InstallPlan,
  InstallResult,
  InstallationReceipt,
  PlannedTarget,
} from '@skillscope/shared';
import { SkillScopeError, toSerializedError } from '@skillscope/shared';
import { readSkillTree } from '../inventory/files.js';
import type { Operation } from '../logging/operation-log.js';
import type { StagedPackage } from '../packages/acquire.js';
import type { SkillScopeStore } from '../persistence/store.js';
import { pathKey, type PlatformContext } from '../platform/context.js';

export const JOURNAL_DIR = 'journal';
export const BACKUP_DIR = 'backups';

/** Written before every filesystem change so an interrupted install can be undone on restart. */
interface JournalStep {
  targetId: string;
  destination: string;
  tmp: string;
  backup: string | null;
  createdDirs: string[];
  incomingHash: string;
  phase: 'pending' | 'copied' | 'backed-up' | 'committed';
}

interface Journal {
  operationId: string;
  startedAt: string;
  steps: JournalStep[];
}

export interface InstallerOptions {
  platform: PlatformContext;
  store: SkillScopeStore;
  dataDir: string;
  operation: Operation;
  /** Test hook: throw from here to simulate a failure at a given point. */
  fault?: (
    point: 'after-copy' | 'before-commit' | 'after-commit',
    index: number,
  ) => void | Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/** Create a directory and report which missing ancestors were created (for rollback). */
async function ensureDir(ctx: PlatformContext, dir: string): Promise<string[]> {
  const missing: string[] = [];
  let cur = dir;
  while (!(await exists(cur))) {
    missing.unshift(cur);
    const parent = ctx.path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (missing.length > 0) await mkdir(dir, { recursive: true });
  return missing;
}

async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (error) {
    if ((error as { code?: string }).code !== 'EXDEV') throw error;
    await cp(src, dest, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await rm(src, { recursive: true, force: true });
  }
}

function journalPath(ctx: PlatformContext, dataDir: string, operationId: string): string {
  return ctx.path.join(dataDir, JOURNAL_DIR, `${operationId}.json`);
}

async function writeJournal(
  ctx: PlatformContext,
  dataDir: string,
  journal: Journal,
): Promise<void> {
  const file = journalPath(ctx, dataDir, journal.operationId);
  await mkdir(ctx.path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(journal));
  await rename(tmp, file);
}

/** Undo one journal step. Only removes content SkillScope itself put in place. */
async function undoStep(ctx: PlatformContext, step: JournalStep, notes: string[]): Promise<void> {
  await rm(step.tmp, { recursive: true, force: true });
  if (step.phase === 'committed' && (await exists(step.destination))) {
    const tree = await readSkillTree(step.destination, ctx);
    if (tree.contentHash === step.incomingHash) {
      await rm(step.destination, { recursive: true, force: true });
    } else {
      notes.push(`Left ${step.destination} in place because it changed after installation.`);
      return;
    }
  }
  if (step.backup && (await exists(step.backup))) {
    if (await exists(step.destination)) {
      notes.push(`Could not restore ${step.backup} because ${step.destination} exists.`);
    } else {
      await rename(step.backup, step.destination);
    }
  }
  for (const dir of [...step.createdDirs].reverse()) {
    await rmdir(dir).catch(() => undefined); // only succeeds when empty
  }
}

async function rollback(ctx: PlatformContext, steps: JournalStep[]): Promise<string[]> {
  const notes: string[] = [];
  for (const step of [...steps].reverse()) {
    try {
      await undoStep(ctx, step, notes);
    } catch (error) {
      notes.push(`Rollback of ${step.destination} failed: ${(error as Error).message}`);
    }
  }
  return notes;
}

/**
 * Undo installations that were interrupted (crash, power loss) before they completed.
 * Called on startup; returns the number of journals processed.
 */
export async function recoverInterruptedInstalls(
  ctx: PlatformContext,
  dataDir: string,
): Promise<{ recovered: number; notes: string[] }> {
  const dir = ctx.path.join(dataDir, JOURNAL_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return { recovered: 0, notes: [] };
  }
  const notes: string[] = [];
  for (const name of names) {
    const file = ctx.path.join(dir, name);
    try {
      const journal = JSON.parse(await readFile(file, 'utf8')) as Journal;
      notes.push(...(await rollback(ctx, journal.steps)));
    } catch (error) {
      notes.push(`Could not process ${name}: ${(error as Error).message}`);
    }
    await rm(file, { force: true });
  }
  return { recovered: names.length, notes };
}

/**
 * Execute a confirmed plan. Each target is copied to a hidden temporary sibling, the existing
 * directory (if replacing) is moved aside, and the new copy is renamed into place. Any failure
 * rolls back every target of the operation, so a multi-agent install is all-or-nothing.
 */
export async function executePlan(
  plan: InstallPlan,
  staged: StagedPackage,
  policy: ConflictPolicy,
  options: InstallerOptions,
): Promise<InstallResult> {
  const { platform: ctx, store, dataDir, operation: op } = options;
  const conflicts = plan.targets.filter((t) => t.conflict !== null);
  if (conflicts.length > 0 && policy === 'abort') {
    throw new SkillScopeError(
      'TARGET_CONFLICT',
      'Something already exists at one or more targets.',
      {
        hint: 'Review the differences, choose another target, or confirm replacement.',
        details: conflicts.map((t) => t.destination),
      },
    );
  }
  // The plan may be stale: refuse if a target appeared since the user reviewed it.
  for (const t of plan.targets) {
    if (t.conflict === null && (await exists(t.destination))) {
      throw new SkillScopeError(
        'TARGET_CONFLICT',
        `${t.destination} appeared after the plan was created.`,
        {
          hint: 'Create a new installation plan to review the change.',
        },
      );
    }
  }

  const shortId = op.record.id.slice(-8);
  const journal: Journal = {
    operationId: op.record.id,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  const incoming = new Map<string, Awaited<ReturnType<typeof readSkillTree>>>();

  try {
    for (const [index, target] of plan.targets.entries()) {
      const skill = staged.inspection.skills.find((s) => s.name === target.skillName);
      if (!skill)
        throw new SkillScopeError(
          'NOT_FOUND',
          `Staged package has no skill "${target.skillName}".`,
        );
      const source = ctx.path.join(staged.dir, ...skill.path.split('/'));
      const tree = incoming.get(source) ?? (await readSkillTree(source, ctx));
      incoming.set(source, tree);

      op.progress(
        `Installing ${target.skillName} for ${target.agentIds.join(', ')}`,
        index,
        plan.targets.length,
      );
      const step: JournalStep = {
        targetId: target.id,
        destination: target.destination,
        tmp: ctx.path.join(target.rootPath, `.skillscope-tmp-${shortId}-${index}`),
        backup: null,
        createdDirs: [],
        incomingHash: tree.contentHash,
        phase: 'pending',
      };
      journal.steps.push(step);
      await writeJournal(ctx, dataDir, journal);

      step.createdDirs = await ensureDir(ctx, target.rootPath);
      await writeJournal(ctx, dataDir, journal);
      await cp(source, step.tmp, { recursive: true, errorOnExist: true, force: false });
      const copied = await readSkillTree(step.tmp, ctx);
      if (copied.contentHash !== tree.contentHash) {
        throw new SkillScopeError(
          'INSTALL_FAILED',
          `Copy verification failed for ${target.destination}.`,
        );
      }
      step.phase = 'copied';
      await writeJournal(ctx, dataDir, journal);
      await options.fault?.('after-copy', index);

      if (await exists(target.destination)) {
        step.backup = ctx.path.join(target.rootPath, `.skillscope-backup-${shortId}-${index}`);
        await writeJournal(ctx, dataDir, journal);
        await rename(target.destination, step.backup);
        step.phase = 'backed-up';
        await writeJournal(ctx, dataDir, journal);
      }
      await options.fault?.('before-commit', index);
      await rename(step.tmp, target.destination);
      step.phase = 'committed';
      await writeJournal(ctx, dataDir, journal);
      await options.fault?.('after-commit', index);
    }
  } catch (error) {
    const notes = await rollback(ctx, journal.steps);
    await rm(journalPath(ctx, dataDir, op.record.id), { force: true });
    notes.forEach((n) => op.note(n));
    const message = error instanceof SkillScopeError ? error.message : (error as Error).message;
    if (notes.some((n) => n.includes('failed') || n.includes('Could not'))) {
      await op.finish('failed', `Installation failed and rollback was incomplete: ${message}`);
      throw new SkillScopeError(
        'ROLLBACK_FAILED',
        `Installation failed and could not be fully rolled back: ${message}`,
        {
          hint: 'See the operation details in the Installation Manager for paths that need attention.',
          details: notes,
          cause: error,
        },
      );
    }
    await op.finish('rolled-back', message);
    const mapped = toSerializedError(error);
    if (mapped.code !== 'INTERNAL') {
      throw new SkillScopeError(mapped.code, `${message} All changes were rolled back.`, {
        hint: mapped.hint ?? 'Nothing was installed.',
        cause: error,
      });
    }
    throw new SkillScopeError(
      'INSTALL_FAILED',
      `Installation failed: ${message}. All changes were rolled back.`,
      {
        hint: 'Check permissions on the target folder and that no program is using it.',
        cause: error,
      },
    );
  }

  // Success: move backups into SkillScope's data folder and record ownership.
  const now = new Date().toISOString();
  const entries: { receipt: InstallationReceipt; destinationKey: string }[] = [];
  for (const [index, target] of plan.targets.entries()) {
    const step = journal.steps[index] as JournalStep;
    let backupPath: string | null = null;
    if (step.backup) {
      backupPath = ctx.path.join(dataDir, BACKUP_DIR, op.record.id, `${index}-${target.skillName}`);
      await mkdir(ctx.path.dirname(backupPath), { recursive: true });
      try {
        await moveDir(step.backup, backupPath);
      } catch (error) {
        backupPath = step.backup;
        op.note(`Backup kept at ${step.backup}: ${(error as Error).message}`);
      }
    }
    const tree = await readSkillTree(target.destination, ctx);
    const key = pathKey(ctx, target.destination);
    const previous = store.activeReceiptAt(key);
    if (previous)
      entries.push({
        receipt: { ...previous, status: 'removed', updatedAt: now },
        destinationKey: key,
      });
    entries.push({ receipt: receiptFor(plan, target, tree, backupPath, now), destinationKey: key });
  }
  await store.saveReceipts(entries);
  await rm(journalPath(ctx, dataDir, op.record.id), { force: true });
  return {
    operation: await op.finish('succeeded'),
    receipts: entries.filter((e) => e.receipt.status === 'installed').map((e) => e.receipt),
  };
}

function receiptFor(
  plan: InstallPlan,
  target: PlannedTarget,
  tree: Awaited<ReturnType<typeof readSkillTree>>,
  backupPath: string | null,
  now: string,
): InstallationReceipt {
  return {
    id: `rcpt_${randomUUID().replace(/-/g, '')}`,
    packageName: plan.packageName,
    version: plan.version,
    integrity: plan.integrity,
    skillName: target.skillName,
    agentIds: [...target.agentIds],
    scope: target.scope,
    rootId: target.rootId,
    rootPath: target.rootPath,
    destination: target.destination,
    installedAt: now,
    updatedAt: now,
    files: tree.files
      .filter((f) => f.kind === 'file')
      .map((f) => ({ path: f.path, sha256: f.sha256 ?? '', size: f.size })),
    contentHash: tree.contentHash,
    backupPath,
    status: 'installed',
  };
}
