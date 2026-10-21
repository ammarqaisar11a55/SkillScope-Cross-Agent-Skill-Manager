import type { Result } from '../errors/index.js';
import type { IpcPayload } from '../schemas/ipc.js';
import type {
  InstallPlan,
  InstallResult,
  InstallationReceipt,
  OperationProgress,
  OperationRecord,
  ReceiptState,
  RemovalPreview,
  UpdateCheck,
  UpdatePreview,
} from './installation.js';
import type { PackageDetails, PackageInspection, RegistrySearchPage } from './packages.js';
import type { AppInfo, Settings } from './settings.js';
import type { InventorySnapshot, SkillDetails } from './skills.js';

/** Response type for each IPC channel. */
export interface IpcResponses {
  'app:info': AppInfo;
  'inventory:scan': InventorySnapshot;
  'inventory:cached': InventorySnapshot | null;
  'inventory:skill-details': SkillDetails;
  'inventory:read-file': { path: string; content: string; truncated: boolean };
  'inventory:reveal': true;
  'registry:search': RegistrySearchPage;
  'registry:details': PackageDetails;
  'packages:inspect': PackageInspection;
  'packages:discard': true;
  'install:plan': InstallPlan;
  'install:execute': InstallResult;
  'receipts:list': ReceiptState[];
  'operations:list': OperationRecord[];
  'updates:check': UpdateCheck[];
  'updates:preview': UpdatePreview;
  'updates:apply': InstallResult;
  'removal:preview': RemovalPreview;
  'removal:execute': OperationRecord;
  'backups:restore': InstallationReceipt;
  'settings:get': Settings;
  'settings:update': Settings;
  'dialog:select-directory': string | null;
  'export:inventory': string | null;
}

export type IpcResponse<C extends keyof IpcResponses> = IpcResponses[C];

/** The API the preload script exposes to the renderer as `window.skillscope`. */
export interface SkillScopeApi {
  invoke<C extends keyof IpcResponses>(
    channel: C,
    ...payload: IpcPayload<C> extends undefined ? [] : [IpcPayload<C>]
  ): Promise<Result<IpcResponses[C]>>;
  onProgress(listener: (progress: OperationProgress) => void): () => void;
  onInventoryUpdated(listener: () => void): () => void;
}
