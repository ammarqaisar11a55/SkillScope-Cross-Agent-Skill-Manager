import { readFile, realpath, stat } from 'node:fs/promises';
import type {
  InventorySnapshot,
  Settings,
  SettingsPatch,
  SkillDetails,
  SkillRecord,
} from '@skillscope/shared';
import { SkillScopeError, settingsSchema } from '@skillscope/shared';
import { AdapterRegistry } from '../agents/registry.js';
import type { AdapterContext } from '../agents/types.js';
import type { ManagedLookup } from '../inventory/build.js';
import { readSkillTree } from '../inventory/files.js';
import { scanInventory } from '../inventory/scan.js';
import { OperationLog } from '../logging/operation-log.js';
import type { SkillScopeStore } from '../persistence/store.js';
import {
  createPlatformContext,
  isInside,
  pathKey,
  type PlatformContext,
} from '../platform/context.js';

export const MAX_PREVIEW_BYTES = 512 * 1024;

export interface ServiceOptions {
  store: SkillScopeStore;
  /** Directory owned by SkillScope for staging, backups and the database. */
  dataDir: string;
  platform?: PlatformContext;
  registry?: AdapterRegistry;
  /** Force offline mode regardless of settings (tests, --offline). */
  offline?: boolean;
  fetch?: typeof fetch;
}

/**
 * Application service layer. Receives requests that have already passed IPC schema validation,
 * applies business rules (allowed paths, confirmations) and calls the engine modules.
 */
export class SkillScopeService {
  readonly log: OperationLog;
  readonly registry: AdapterRegistry;
  readonly platform: PlatformContext;
  protected readonly store: SkillScopeStore;
  protected readonly dataDir: string;
  protected readonly options: ServiceOptions;
  private snapshot: InventorySnapshot | null = null;
  private scanning: Promise<InventorySnapshot> | null = null;

  constructor(options: ServiceOptions) {
    this.options = options;
    this.store = options.store;
    this.dataDir = options.dataDir;
    this.platform = options.platform ?? createPlatformContext();
    this.registry = options.registry ?? new AdapterRegistry();
    this.log = new OperationLog(options.store);
  }

  // ---- settings -------------------------------------------------------------------------

  settings(): Settings {
    return this.store.getSettings();
  }

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    const merged: Settings = { ...this.settings(), ...patch } as Settings;
    const parsed = settingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new SkillScopeError('INVALID_REQUEST', 'Settings are invalid.', {
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const next = parsed.data;
    if (next.workspaceRoot !== null) {
      if (!this.platform.path.isAbsolute(next.workspaceRoot)) {
        throw new SkillScopeError('INVALID_REQUEST', 'The workspace must be an absolute path.');
      }
      const st = await stat(next.workspaceRoot).catch(() => null);
      if (!st?.isDirectory()) {
        throw new SkillScopeError(
          'NOT_FOUND',
          `The workspace folder ${next.workspaceRoot} does not exist.`,
        );
      }
    }
    for (const loc of next.customLocations) {
      if (
        loc.scope === 'global' &&
        !this.platform.path.isAbsolute(loc.path) &&
        !loc.path.startsWith('~')
      ) {
        throw new SkillScopeError(
          'INVALID_REQUEST',
          `Custom location "${loc.label}" must be an absolute path.`,
        );
      }
    }
    await this.store.saveSettings(next);
    return next;
  }

  adapterContext(settings: Settings = this.settings()): AdapterContext {
    return {
      platform: this.platform,
      workspaceRoot: settings.workspaceRoot,
      includeSystemRoots: settings.scan.includeSystemRoots,
      maxDepth: settings.scan.maxDepth,
      customLocations: settings.customLocations,
    };
  }

  // ---- inventory ------------------------------------------------------------------------

  protected managedLookup(): ManagedLookup {
    const byKey = new Map(
      this.store.listReceipts().map((r) => [pathKey(this.platform, r.destination), r] as const),
    );
    return (key) => {
      const r = byKey.get(key);
      return r
        ? {
            receiptId: r.id,
            packageName: r.packageName,
            version: r.version,
            contentHash: r.contentHash,
          }
        : null;
    };
  }

  /** Scan the filesystem. Concurrent calls share one scan. */
  async scan(): Promise<InventorySnapshot> {
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      const settings = this.settings();
      const op = await this.log.start('scan', 'Scanning skill directories');
      try {
        const snapshot = await scanInventory(this.registry, this.adapterContext(settings), {
          followSymlinks: settings.scan.followSymlinks,
          managed: this.managedLookup(),
        });
        this.snapshot = snapshot;
        await this.store.saveSnapshot(snapshot);
        op.note(
          `${snapshot.stats.uniqueSkills} skills, ${snapshot.stats.availabilityRecords} agent availability records`,
        );
        await op.finish('succeeded');
        await this.store.pruneHistory(settings.historyRetentionDays);
        return snapshot;
      } catch (error) {
        await op.finish('failed', (error as Error).message);
        throw error;
      }
    })();
    try {
      return await this.scanning;
    } finally {
      this.scanning = null;
    }
  }

  /** The last scan, from memory or the database, for offline viewing. */
  cachedInventory(): InventorySnapshot | null {
    return this.snapshot ?? this.store.latestSnapshot();
  }

  protected async currentInventory(): Promise<InventorySnapshot> {
    return this.snapshot ?? (await this.scan());
  }

  async findSkill(id: string): Promise<SkillRecord> {
    const snapshot = await this.currentInventory();
    const skill = snapshot.skills.find((s) => s.id === id);
    if (!skill) {
      throw new SkillScopeError('NOT_FOUND', 'That skill is no longer in the inventory.', {
        hint: 'Rescan to refresh the inventory.',
      });
    }
    return skill;
  }

  async skillDetails(id: string): Promise<SkillDetails> {
    const skill = await this.findSkill(id);
    const tree = await readSkillTree(skill.path, this.platform);
    let skillMd: string | null = null;
    const skillFile = tree.files.find(
      (f) => f.kind === 'file' && f.path.toLowerCase() === 'skill.md',
    );
    if (skillFile) {
      skillMd = (await this.readSkillFile(id, skillFile.path)).content;
    }
    const snapshot = await this.currentInventory();
    const duplicates = snapshot.skills.filter(
      (s) =>
        s.id !== skill.id && s.duplicateGroupIds.some((g) => skill.duplicateGroupIds.includes(g)),
    );
    return {
      skill,
      files: tree.files.map(({ path, size, kind }) => ({ path, size, kind })),
      skillMd,
      duplicates,
    };
  }

  /** Read one file inside a skill. The resolved real path must stay inside the skill directory. */
  async readSkillFile(
    id: string,
    relativePath: string,
  ): Promise<{ path: string; content: string; truncated: boolean }> {
    const skill = await this.findSkill(id);
    const segments = relativePath.split('/');
    if (segments.some((s) => s === '..' || s === '')) {
      throw new SkillScopeError('PATH_OUTSIDE_ROOT', 'Invalid file path.');
    }
    const target = this.platform.path.join(skill.realPath, ...segments);
    const real = await realpath(target);
    if (!isInside(this.platform, await realpath(skill.realPath), real, false)) {
      throw new SkillScopeError(
        'PATH_OUTSIDE_ROOT',
        'The file resolves outside the skill directory.',
      );
    }
    const st = await stat(real);
    if (!st.isFile())
      throw new SkillScopeError('INVALID_REQUEST', 'Only regular files can be previewed.');
    const buffer = await readFile(real);
    const slice = buffer.subarray(0, MAX_PREVIEW_BYTES);
    const binary = slice.includes(0);
    return {
      path: relativePath,
      content: binary ? `[binary file, ${st.size} bytes]` : slice.toString('utf8'),
      truncated: buffer.length > MAX_PREVIEW_BYTES,
    };
  }

  /** Directory to reveal in the OS file manager; only skills from the inventory qualify. */
  async skillDirectory(id: string): Promise<string> {
    return (await this.findSkill(id)).path;
  }
}
