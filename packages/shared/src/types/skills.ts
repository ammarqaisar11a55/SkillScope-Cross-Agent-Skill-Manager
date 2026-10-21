import type { AgentDetection, AgentId, RootRelation, RootStatus, SkillScopeKind } from './agents.js';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export type ValidationCategory =
  | 'structure'
  | 'metadata'
  | 'references'
  | 'security'
  | 'compatibility';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  category: ValidationCategory;
  message: string;
  /** A safe next step the user can take. */
  hint: string;
  /** Path relative to the skill directory, when the issue concerns a specific file. */
  path?: string;
  agentId?: AgentId;
}

export type ValidationState = 'valid' | 'warnings' | 'invalid';

export interface ValidationReport {
  state: ValidationState;
  issues: ValidationIssue[];
}

export type SkillStatus =
  | 'detected'
  | 'valid'
  | 'invalid-metadata'
  | 'missing-required-file'
  | 'shared-location'
  | 'duplicate-content'
  | 'duplicate-name'
  | 'installed-skillscope'
  | 'installed-external'
  | 'changes-detected'
  | 'runtime-unverified';

export const SKILL_STATUS_LABELS: Readonly<Record<SkillStatus, string>> = {
  detected: 'Detected',
  valid: 'Valid',
  'invalid-metadata': 'Invalid metadata',
  'missing-required-file': 'Missing required file',
  'shared-location': 'Shared location',
  'duplicate-content': 'Duplicate content',
  'duplicate-name': 'Duplicate name',
  'installed-skillscope': 'Installed through SkillScope',
  'installed-external': 'Installed externally',
  'changes-detected': 'Changes detected',
  'runtime-unverified': 'Runtime activation unverified',
};

/** Why a particular agent is considered able to discover a skill. */
export interface AgentAvailability {
  agentId: AgentId;
  rootId: string;
  rootPath: string;
  scope: SkillScopeKind;
  relation: RootRelation;
  reason: string;
}

export type FileKind = 'file' | 'directory' | 'symlink' | 'other';

export interface SkillFileEntry {
  /** POSIX-style path relative to the skill directory. */
  path: string;
  size: number;
  kind: FileKind;
}

export type ManagementStatus = 'external' | 'managed' | 'modified';

export interface SkillPackageRef {
  name: string;
  version: string;
  receiptId: string;
}

export interface SkillRecord {
  /** Stable identifier derived from the canonical (real) path of the skill directory. */
  id: string;
  name: string;
  /** Directory name, which may differ from the manifest name. */
  directoryName: string;
  description: string | null;
  frontmatter: Record<string, unknown>;
  /** Path as discovered (may be a symlink). */
  path: string;
  /** Canonical path after resolving symlinks. */
  realPath: string;
  isSymlink: boolean;
  scope: SkillScopeKind;
  availability: AgentAvailability[];
  contentHash: string;
  fileCount: number;
  totalBytes: number;
  /** ISO timestamp of the most recent modification inside the skill directory. */
  modifiedAt: string;
  detectedAt: string;
  validation: ValidationReport;
  statuses: SkillStatus[];
  /** True when the skill sits in a directory that more than one agent reads. */
  sharedLocation: boolean;
  duplicateGroupIds: string[];
  management: ManagementStatus;
  package: SkillPackageRef | null;
}

export interface DuplicateGroup {
  id: string;
  kind: 'content' | 'name';
  /** Content hash or normalised name. */
  key: string;
  skillIds: string[];
}

export interface InventoryStats {
  /** Number of distinct physical skill directories. */
  uniqueSkills: number;
  /** Number of (skill, agent) availability pairs. */
  availabilityRecords: number;
  perAgent: Record<AgentId, number>;
  detectedAgents: number;
  sharedSkills: number;
  duplicateGroups: number;
  problematicSkills: number;
}

export interface InventorySnapshot {
  generatedAt: string;
  platform: string;
  workspaceRoot: string | null;
  skills: SkillRecord[];
  agents: AgentDetection[];
  roots: RootStatus[];
  duplicateGroups: DuplicateGroup[];
  stats: InventoryStats;
  /** True when served from the local database instead of a fresh filesystem scan. */
  fromCache: boolean;
  scanDurationMs: number;
}

export type InventorySortKey = 'name' | 'agent' | 'modified';

export interface InventoryQuery {
  text?: string;
  agents?: AgentId[];
  scopes?: SkillScopeKind[];
  validation?: ValidationState[];
  source?: 'all' | 'npm' | 'external';
  sort?: InventorySortKey;
  direction?: 'asc' | 'desc';
}

export interface SkillDetails {
  skill: SkillRecord;
  files: SkillFileEntry[];
  skillMd: string | null;
  duplicates: SkillRecord[];
}
