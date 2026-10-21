import { writeFile } from 'node:fs/promises';
import type { AppInfo } from '@skillscope/shared';
import { EXPORT_EXTENSIONS, type SkillScopeApp } from '@skillscope/core';
import type { IpcHandlers } from './ipc.js';

/** Native capabilities the handlers need, injected so they can be unit tested without Electron. */
export interface DesktopBridge {
  appInfo(): AppInfo;
  selectDirectory(title: string): Promise<string | null>;
  saveFile(defaultName: string, extension: string): Promise<string | null>;
  revealInFileManager(path: string): Promise<void>;
}

export function createHandlers(app: SkillScopeApp, bridge: DesktopBridge): IpcHandlers {
  return {
    'app:info': () => bridge.appInfo(),
    'inventory:scan': () => app.scan(),
    'inventory:cached': () => app.cachedInventory(),
    'inventory:skill-details': ({ skillId }) => app.skillDetails(skillId),
    'inventory:read-file': ({ skillId, path }) => app.readSkillFile(skillId, path),
    'inventory:reveal': async ({ skillId }) => {
      // Only directories from the inventory can be revealed, never arbitrary renderer paths.
      await bridge.revealInFileManager(await app.skillDirectory(skillId));
      return true as const;
    },
    'registry:search': (query) => app.searchRegistry(query),
    'registry:details': ({ name }) => app.packageDetails(name),
    'packages:inspect': ({ name, version }) => app.inspectPackage(name, version),
    'packages:discard': async ({ stagingId }) => {
      await app.discardPackage(stagingId);
      return true as const;
    },
    'install:plan': (request) => app.planInstall(request),
    'install:execute': ({ planId, conflictPolicy, confirmed }) =>
      app.executeInstall(planId, conflictPolicy, confirmed),
    'receipts:list': () => app.receiptStates(),
    'operations:list': (payload) => app.operations(payload?.limit ?? 200),
    'updates:check': () => app.checkUpdates(),
    'updates:preview': ({ receiptId, version }) => app.previewUpdate(receiptId, version),
    'updates:apply': ({ receiptId, stagingId, confirmed, overwriteModified }) =>
      app.applyUpdate(receiptId, stagingId, confirmed, overwriteModified),
    'removal:preview': ({ receiptId }) => app.previewRemoval(receiptId),
    'removal:execute': ({ receiptId, removeModified, confirmed }) =>
      app.remove(receiptId, removeModified, confirmed),
    'backups:restore': ({ receiptId, confirmed }) => app.restoreBackup(receiptId, confirmed),
    'settings:get': () => app.settings(),
    'settings:update': (patch) => app.updateSettings(patch),
    'dialog:select-directory': (payload) =>
      bridge.selectDirectory(payload?.title ?? 'Select folder'),
    'export:inventory': async ({ format }) => {
      const content = await app.exportInventory(format);
      const stamp = new Date().toISOString().slice(0, 10);
      const target = await bridge.saveFile(
        `skillscope-inventory-${stamp}.${EXPORT_EXTENSIONS[format]}`,
        EXPORT_EXTENSIONS[format],
      );
      if (!target) return null;
      await writeFile(target, content, 'utf8');
      return target;
    },
  };
}
