import { cp, lstat, mkdir, rename, rm } from 'node:fs/promises';
import type {
  ConflictPolicy,
  ExportFormat,
  InstallPlan,
  InstallPlanRequest,
  InstallResult,
  InstallationReceipt,
  OperationRecord,
  PackageDetails,
  PackageInspection,
  ReceiptState,
  RegistrySearchPage,
  RegistrySearchQuery,
  RemovalPreview,
  UpdateCheck,
  UpdatePreview,
} from '@skillscope/shared';
import { SkillScopeError } from '@skillscope/shared';
import { exportInventory } from '../export/inventory-export.js';
import { readSkillTree } from '../inventory/files.js';
import { diffTrees } from '../installation/diff.js';
import {
  BACKUP_DIR,
  executePlan,
  recoverInterruptedInstalls,
  type InstallerOptions,
} from '../installation/installer.js';
import { planInstall } from '../installation/planner.js';
import { acquirePackage, type StagedPackage } from '../packages/acquire.js';
import { NpmRegistryClient } from '../packages/registry.js';
import { discardStaging, pruneStaging } from '../packages/staging.js';
import { pathKey } from '../platform/context.js';
import {
  assertManagedDestination,
  previewRemoval,
  removeBackup,
  removeManagedFiles,
} from '../removal/remover.js';
import { checkUpdates, updatePlan } from '../removal/updates.js';
import { SkillScopeService, type ServiceOptions } from './service.js';

const PLAN_TTL_MS = 30 * 60 * 1000;

/**
 * The full application service: inventory and settings (from SkillScopeService) plus the npm
 * marketplace, installation, updates, removal, backups and export.
 */
export class SkillScopeApp extends SkillScopeService {
  private readonly staged = new Map<string, StagedPackage>();
  private readonly plans = new Map<string, { plan: InstallPlan; createdAt: number }>();
  /** Test hook passed to the installer. */
  installFault: InstallerOptions['fault'];

  constructor(options: ServiceOptions) {
    super(options);
  }

  /** Startup housekeeping: undo interrupted installs and delete stale staging folders. */
  async initialize(): Promise<{ recovered: number; notes: string[] }> {
    const result = await recoverInterruptedInstalls(this.platform, this.dataDir);
    if (result.recovered > 0) {
      const op = await this.log.start(
        'install',
        `Recovered ${result.recovered} interrupted installation(s)`,
      );
      result.notes.forEach((n) => op.note(n));
      await op.finish(
        'rolled-back',
        'A previous installation was interrupted and has been rolled back.',
      );
    }
    await pruneStaging(this.platform, this.dataDir);
    return result;
  }

  private client(): NpmRegistryClient {
    const settings = this.settings();
    return new NpmRegistryClient({
      url: settings.registry.url,
      timeoutMs: settings.registry.timeoutMs,
      retries: settings.registry.retries,
      offline: this.options.offline === true || !settings.privacy.allowNetwork,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
  }

  // ---- marketplace ----------------------------------------------------------------------

  searchRegistry(query: RegistrySearchQuery): Promise<RegistrySearchPage> {
    return this.client().search(query);
  }

  packageDetails(name: string): Promise<PackageDetails> {
    return this.client().details(name);
  }

  async inspectPackage(name: string, version: string): Promise<PackageInspection> {
    const op = await this.log.start('install', `Inspecting ${name}@${version}`, {
      packageName: name,
      version,
    });
    try {
      const staged = await acquirePackage(name, version, {
        ctx: this.platform,
        dataDir: this.dataDir,
        client: this.client(),
        registry: this.registry,
        onStep: (s, done, total) => op.progress(s, done, total),
      });
      this.staged.set(staged.inspection.stagingId, staged);
      op.note(
        staged.inspection.installable
          ? 'Package passed validation.'
          : 'Package is not installable.',
      );
      // Inspection itself is not an installation; record it as succeeded but keep it out of history noise.
      await op.finish(
        staged.inspection.installable ? 'succeeded' : 'failed',
        staged.inspection.installable ? undefined : 'Package failed validation.',
      );
      return staged.inspection;
    } catch (error) {
      await op.finish('failed', (error as Error).message);
      throw error;
    }
  }

  private getStaged(stagingId: string): StagedPackage {
    const staged = this.staged.get(stagingId);
    if (!staged) {
      throw new SkillScopeError('NOT_FOUND', 'The inspected package is no longer available.', {
        hint: 'Inspect the package again.',
      });
    }
    return staged;
  }

  async discardPackage(stagingId: string): Promise<void> {
    this.staged.delete(stagingId);
    for (const [id, entry] of this.plans)
      if (entry.plan.stagingId === stagingId) this.plans.delete(id);
    await discardStaging(this.platform, this.dataDir, stagingId);
  }

  // ---- installation ---------------------------------------------------------------------

  async planInstall(request: InstallPlanRequest): Promise<InstallPlan> {
    const staged = this.getStaged(request.stagingId);
    const plan = await planInstall(
      { ctx: this.adapterContext(), registry: this.registry, store: this.store },
      staged,
      request,
    );
    this.plans.set(plan.id, { plan, createdAt: Date.now() });
    return plan;
  }

  async executeInstall(
    planId: string,
    policy: ConflictPolicy,
    confirmed: boolean,
  ): Promise<InstallResult> {
    if (!confirmed) {
      throw new SkillScopeError(
        'CONFIRMATION_REQUIRED',
        'Installation needs explicit confirmation.',
        {
          hint: 'Review the targets and the third-party content warning, then confirm.',
        },
      );
    }
    const entry = this.plans.get(planId);
    if (!entry || Date.now() - entry.createdAt > PLAN_TTL_MS) {
      this.plans.delete(planId);
      throw new SkillScopeError('NOT_FOUND', 'The installation plan expired.', {
        hint: 'Review the installation again.',
      });
    }
    const staged = this.getStaged(entry.plan.stagingId);
    const op = await this.log.start(
      'install',
      `Install ${entry.plan.packageName}@${entry.plan.version} to ${entry.plan.targets.length} target(s)`,
      { packageName: entry.plan.packageName, version: entry.plan.version },
    );
    try {
      const result = await executePlan(entry.plan, staged, policy, this.installerOptions(op));
      this.plans.delete(planId);
      await this.scan();
      return result;
    } catch (error) {
      if (op.record.state === 'running') await op.finish('failed', (error as Error).message);
      throw error;
    }
  }

  private installerOptions(op: InstallerOptions['operation']): InstallerOptions {
    const options: InstallerOptions = {
      platform: this.platform,
      store: this.store,
      dataDir: this.dataDir,
      operation: op,
    };
    if (this.installFault) options.fault = this.installFault;
    return options;
  }

  // ---- installation manager -------------------------------------------------------------

  private receipt(id: string): InstallationReceipt {
    const receipt = this.store.getReceipt(id);
    if (!receipt || receipt.status !== 'installed') {
      throw new SkillScopeError('NOT_FOUND', 'That installation record does not exist.');
    }
    return receipt;
  }

  async receiptStates(): Promise<ReceiptState[]> {
    const ctx = this.adapterContext();
    const out: ReceiptState[] = [];
    for (const receipt of this.store.listReceipts()) {
      const present = await lstat(receipt.destination).then(
        (s) => s.isDirectory(),
        () => false,
      );
      if (!present) {
        out.push({
          receipt,
          present,
          modifiedFiles: [],
          missingFiles: receipt.files.map((f) => f.path),
          extraFiles: [],
        });
        continue;
      }
      const preview = await previewRemoval(ctx, receipt);
      out.push({
        receipt,
        present,
        modifiedFiles: preview.modifiedFiles,
        missingFiles: preview.missingFiles,
        extraFiles: preview.unownedFiles,
      });
    }
    return out;
  }

  operations(limit = 200): OperationRecord[] {
    return this.store.listOperations(limit);
  }

  checkUpdates(): Promise<UpdateCheck[]> {
    return checkUpdates(this.client(), this.store.listReceipts());
  }

  async previewUpdate(receiptId: string, version?: string): Promise<UpdatePreview> {
    const receipt = this.receipt(receiptId);
    const target =
      version ?? (await this.client().packument(receipt.packageName))['dist-tags']?.latest;
    if (!target)
      throw new SkillScopeError('PACKAGE_NOT_FOUND', 'The registry lists no latest version.');
    const inspection = await this.inspectPackage(receipt.packageName, target);
    const staged = this.getStaged(inspection.stagingId);
    const skill = inspection.skills.find((s) => s.name === receipt.skillName);
    const current = await readSkillTree(receipt.destination, this.platform);
    const removal = await previewRemoval(this.adapterContext(), receipt);
    let diff: UpdatePreview['diff'] = [];
    if (skill) {
      const incoming = await readSkillTree(
        this.platform.path.join(staged.dir, ...skill.path.split('/')),
        this.platform,
      );
      diff = diffTrees(current.files, incoming.files);
    }
    return {
      receiptId,
      packageName: receipt.packageName,
      skillName: receipt.skillName,
      from: receipt.version,
      to: target,
      stagingId: inspection.stagingId,
      diff,
      localModifications: [...removal.modifiedFiles, ...removal.unownedFiles],
      skillPresentInNewVersion: Boolean(
        skill && skill.validation.state !== 'invalid' && inspection.installable,
      ),
    };
  }

  async applyUpdate(
    receiptId: string,
    stagingId: string,
    confirmed: boolean,
    overwriteModified: boolean,
  ): Promise<InstallResult> {
    if (!confirmed)
      throw new SkillScopeError('CONFIRMATION_REQUIRED', 'Updating needs explicit confirmation.');
    const receipt = this.receipt(receiptId);
    const staged = this.getStaged(stagingId);
    if (staged.inspection.name !== receipt.packageName) {
      throw new SkillScopeError(
        'INVALID_REQUEST',
        'The staged package does not match this installation.',
      );
    }
    if (
      !staged.inspection.installable ||
      !staged.inspection.skills.some(
        (s) => s.name === receipt.skillName && s.validation.state !== 'invalid',
      )
    ) {
      throw new SkillScopeError(
        'VALIDATION_FAILED',
        `The new version does not contain a valid "${receipt.skillName}" skill.`,
      );
    }
    await assertManagedDestination(this.adapterContext(), this.registry, receipt);
    const preview = await previewRemoval(this.adapterContext(), receipt);
    const local = [...preview.modifiedFiles, ...preview.unownedFiles];
    if (local.length > 0 && !overwriteModified) {
      throw new SkillScopeError('MODIFIED_FILES', 'The installed skill has local changes.', {
        hint: 'Review the modified files. Confirm overwriting to replace them; a backup is kept.',
        details: local,
      });
    }
    const op = await this.log.start(
      'update',
      `Update ${receipt.skillName} ${receipt.version} → ${staged.inspection.version}`,
      {
        packageName: receipt.packageName,
        version: staged.inspection.version,
      },
    );
    try {
      const result = await executePlan(
        updatePlan(receipt, staged),
        staged,
        'replace',
        this.installerOptions(op),
      );
      await this.scan();
      return result;
    } catch (error) {
      if (op.record.state === 'running') await op.finish('failed', (error as Error).message);
      throw error;
    }
  }

  async previewRemoval(receiptId: string): Promise<RemovalPreview> {
    const receipt = this.receipt(receiptId);
    await assertManagedDestination(this.adapterContext(), this.registry, receipt);
    return previewRemoval(this.adapterContext(), receipt);
  }

  async remove(
    receiptId: string,
    removeModified: boolean,
    confirmed: boolean,
  ): Promise<OperationRecord> {
    if (!confirmed)
      throw new SkillScopeError('CONFIRMATION_REQUIRED', 'Removal needs explicit confirmation.');
    const receipt = this.receipt(receiptId);
    const ctx = this.adapterContext();
    await assertManagedDestination(ctx, this.registry, receipt);
    const op = await this.log.start(
      'remove',
      `Remove ${receipt.skillName} (${receipt.packageName}@${receipt.version})`,
      {
        packageName: receipt.packageName,
        version: receipt.version,
      },
    );
    try {
      const result = await removeManagedFiles(ctx, receipt, removeModified);
      op.note(`Removed ${result.removed.length} file(s).`);
      if (result.kept.length > 0)
        op.note(
          `Kept ${result.kept.length} file(s) not owned or modified: ${result.kept.join(', ')}`,
        );
      await this.store.saveReceipt(
        { ...receipt, status: 'removed', updatedAt: new Date().toISOString() },
        pathKey(this.platform, receipt.destination),
      );
      const record = await op.finish('succeeded');
      await this.scan();
      return record;
    } catch (error) {
      await op.finish('failed', (error as Error).message);
      throw error;
    }
  }

  /** Put back the content that an installation replaced. The current content is backed up first. */
  async restoreBackup(receiptId: string, confirmed: boolean): Promise<InstallationReceipt> {
    if (!confirmed)
      throw new SkillScopeError('CONFIRMATION_REQUIRED', 'Restoring needs explicit confirmation.');
    const receipt = this.receipt(receiptId);
    if (!receipt.backupPath)
      throw new SkillScopeError('NOT_FOUND', 'This installation has no backup.');
    const backupRoot = this.platform.path.join(this.dataDir, BACKUP_DIR);
    const backupInside = pathKey(this.platform, receipt.backupPath).startsWith(
      pathKey(this.platform, backupRoot),
    );
    const backupSibling =
      pathKey(this.platform, this.platform.path.dirname(receipt.backupPath)) ===
      pathKey(this.platform, receipt.rootPath);
    if (!backupInside && !backupSibling)
      throw new SkillScopeError('PATH_OUTSIDE_ROOT', 'The backup path is not owned by SkillScope.');
    const backupExists = await lstat(receipt.backupPath).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!backupExists)
      throw new SkillScopeError('NOT_FOUND', 'The backup folder no longer exists.');
    await assertManagedDestination(this.adapterContext(), this.registry, receipt);

    const op = await this.log.start('restore', `Restore backup of ${receipt.skillName}`, {
      packageName: receipt.packageName,
      version: receipt.version,
    });
    const aside = this.platform.path.join(
      this.dataDir,
      BACKUP_DIR,
      op.record.id,
      `replaced-${receipt.skillName}`,
    );
    try {
      await rm(aside, { recursive: true, force: true });
      await mkdir(this.platform.path.dirname(aside), { recursive: true });
      if (
        await lstat(receipt.destination).then(
          () => true,
          () => false,
        )
      ) {
        await cp(receipt.destination, aside, { recursive: true, verbatimSymlinks: true });
        await rm(receipt.destination, { recursive: true, force: true });
      }
      try {
        await rename(receipt.backupPath, receipt.destination);
      } catch {
        await cp(receipt.backupPath, receipt.destination, {
          recursive: true,
          verbatimSymlinks: true,
        });
        await removeBackup(receipt.backupPath);
      }
      op.note(`Previous content kept at ${aside}.`);
      const key = pathKey(this.platform, receipt.destination);
      const restored = await readSkillTree(receipt.destination, this.platform);
      const now = new Date().toISOString();
      const previous = this.store
        .listReceipts(true)
        .find(
          (r) =>
            r.id !== receipt.id &&
            r.status === 'removed' &&
            pathKey(this.platform, r.destination) === key &&
            r.contentHash === restored.contentHash,
        );
      const updates: { receipt: InstallationReceipt; destinationKey: string }[] = [
        {
          receipt: { ...receipt, status: 'removed', backupPath: aside, updatedAt: now },
          destinationKey: key,
        },
      ];
      if (previous)
        updates.push({
          receipt: { ...previous, status: 'installed', updatedAt: now },
          destinationKey: key,
        });
      await this.store.saveReceipts(updates);
      await op.finish('succeeded');
      await this.scan();
      return previous
        ? { ...previous, status: 'installed', updatedAt: now }
        : { ...receipt, status: 'removed', backupPath: aside, updatedAt: now };
    } catch (error) {
      await op.finish('failed', (error as Error).message);
      throw error;
    }
  }

  // ---- export ---------------------------------------------------------------------------

  async exportInventory(format: ExportFormat): Promise<string> {
    const snapshot = this.cachedInventory() ?? (await this.scan());
    const op = await this.log.start('export', `Export inventory as ${format}`);
    const content = exportInventory(snapshot, format);
    await op.finish('succeeded');
    return content;
  }
}
