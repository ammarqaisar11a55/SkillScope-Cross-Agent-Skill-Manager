import type { AgentId, InstallScope } from './agents.js';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface CustomSkillLocation {
  id: string;
  agentId: AgentId;
  scope: InstallScope;
  /** Absolute path, or a path relative to the workspace for project scope. */
  path: string;
  label: string;
  installable: boolean;
}

export interface RegistrySettings {
  url: string;
  timeoutMs: number;
  retries: number;
}

export interface ScanSettings {
  followSymlinks: boolean;
  includeSystemRoots: boolean;
  scanOnStartup: boolean;
  /** Upper bound on nested category depth for recursive roots. */
  maxDepth: number;
}

export interface PrivacySettings {
  /** When false, the application never contacts the npm registry. */
  allowNetwork: boolean;
}

export interface Settings {
  theme: ThemePreference;
  defaultScope: InstallScope;
  workspaceRoot: string | null;
  customLocations: CustomSkillLocation[];
  registry: RegistrySettings;
  scan: ScanSettings;
  historyRetentionDays: number;
  privacy: PrivacySettings;
}

export type ExportFormat = 'json' | 'csv' | 'markdown';

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  dataDirectory: string;
}
