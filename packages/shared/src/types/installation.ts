import type { AgentId, InstallScope } from './agents.js';

export interface InstallTargetRequest {
  agentId: AgentId;
  scope: InstallScope;
  /** Override the adapter's default root with a specific installable root id. */
  rootId?: string;
}

export type ConflictPolicy = 'abort' | 'replace';

export interface InstallPlanRequest {
  stagingId: string;
  skills: string[];
  targets: InstallTargetRequest[];
  /** Allow multiple agents that read the same directory to share one copy. */
  allowSharedInstall: boolean;
}

export type FileChange = 'added' | 'removed' | 'modified' | 'unchanged';

export interface FileDiff {
  path: string;
  change: FileChange;
}

export type ConflictKind = 'managed' | 'managed-modified' | 'external' | 'not-a-directory';

export interface ConflictInfo {
  kind: ConflictKind;
  existingPath: string;
  existingHash: string | null;
  incomingHash: string;
  identical: boolean;
  diff: FileDiff[];
  receiptId: string | null;
}

export interface PlannedTarget {
  id: string;
  skillName: string;
  /** All agents served by this destination. More than one only for an explicit shared install. */
  agentIds: AgentId[];
  scope: InstallScope;
  rootId: string;
  rootPath: string;
  destination: string;
  shared: boolean;
  note: string | null;
  conflict: ConflictInfo | null;
}

export interface InstallPlan {
  id: string;
  stagingId: string;
  packageName: string;
  version: string;
  integrity: string | null;
  targets: PlannedTarget[];
  warnings: string[];
  createdAt: string;
}

export interface InstallExecuteRequest {
  planId: string;
  conflictPolicy: ConflictPolicy;
  /** The user explicitly confirmed the plan, including third-party content warnings. */
  confirmed: boolean;
}

export interface ManagedFile {
  /** POSIX path relative to the skill destination. */
  path: string;
  sha256: string;
  size: number;
}

export type ReceiptStatus = 'installed' | 'removed';

export interface InstallationReceipt {
  id: string;
  packageName: string;
  version: string;
  integrity: string | null;
  skillName: string;
  agentIds: AgentId[];
  scope: InstallScope;
  rootId: string;
  rootPath: string;
  destination: string;
  installedAt: string;
  updatedAt: string;
  files: ManagedFile[];
  contentHash: string;
  backupPath: string | null;
  status: ReceiptStatus;
}

export type OperationKind = 'scan' | 'install' | 'update' | 'remove' | 'restore' | 'export';

export type OperationState = 'running' | 'succeeded' | 'failed' | 'rolled-back' | 'cancelled';

export interface OperationRecord {
  id: string;
  kind: OperationKind;
  state: OperationState;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  packageName: string | null;
  version: string | null;
  details: string[];
  error: string | null;
}

export interface OperationProgress {
  operationId: string;
  kind: OperationKind;
  step: string;
  completed: number;
  total: number;
}

export interface InstallResult {
  operation: OperationRecord;
  receipts: InstallationReceipt[];
}

export interface ReceiptState {
  receipt: InstallationReceipt;
  present: boolean;
  modifiedFiles: string[];
  missingFiles: string[];
  extraFiles: string[];
}

export interface UpdateCheck {
  receiptId: string;
  packageName: string;
  skillName: string;
  installed: string;
  latest: string | null;
  updateAvailable: boolean;
  error: string | null;
}

export interface UpdatePreview {
  receiptId: string;
  packageName: string;
  skillName: string;
  from: string;
  to: string;
  stagingId: string;
  diff: FileDiff[];
  localModifications: string[];
  skillPresentInNewVersion: boolean;
}

export interface RemovalPreview {
  receiptId: string;
  destination: string;
  filesToRemove: string[];
  modifiedFiles: string[];
  unownedFiles: string[];
  missingFiles: string[];
}

export interface RemovalRequest {
  receiptId: string;
  /** Also delete files the user modified after installation. Unowned files are always kept. */
  removeModified: boolean;
}

export interface BackupEntry {
  receiptId: string;
  backupPath: string;
  destination: string;
  createdAt: string;
}
