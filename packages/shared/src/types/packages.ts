import type { AgentId } from './agents.js';
import type { SkillFileEntry, ValidationIssue, ValidationReport } from './skills.js';

export interface RegistrySearchQuery {
  text: string;
  /** Restrict to packages that advertise compatibility with these agents via keywords. */
  agents?: AgentId[];
  from?: number;
  size?: number;
}

export interface RegistrySearchResult {
  name: string;
  version: string;
  description: string | null;
  keywords: string[];
  date: string | null;
  publisher: string | null;
  maintainers: string[];
  links: { npm?: string; repository?: string; homepage?: string };
  /** Agents suggested by package keywords. A claim, not a guarantee. */
  agentHints: AgentId[];
}

export interface RegistrySearchPage {
  total: number;
  results: RegistrySearchResult[];
}

export interface PackageVersionSummary {
  version: string;
  publishedAt: string | null;
  deprecated: string | null;
  hasIntegrity: boolean;
  unpackedSize: number | null;
  fileCount: number | null;
}

export interface PackageDetails {
  name: string;
  description: string | null;
  distTags: Record<string, string>;
  versions: PackageVersionSummary[];
  maintainers: string[];
  repository: string | null;
  homepage: string | null;
  license: string | null;
  keywords: string[];
}

export interface IntegrityResult {
  algorithm: 'sha512' | 'sha1' | 'none';
  expected: string | null;
  actual: string;
  verified: boolean;
}

export interface InspectedSkill {
  name: string;
  /** Package-relative POSIX path of the skill directory. */
  path: string;
  declaredAgents: AgentId[];
  description: string | null;
  validation: ValidationReport;
  files: SkillFileEntry[];
  skillMd: string;
  contentHash: string;
}

export interface PackageInspection {
  /** Identifier of the staged package on disk; required to plan an installation. */
  stagingId: string;
  name: string;
  version: string;
  tarballUrl: string;
  integrity: IntegrityResult;
  manifestSource: 'agent-skill.json' | 'none';
  schemaVersion: number | null;
  skills: InspectedSkill[];
  /** All package-relative paths in the archive. */
  files: string[];
  totalBytes: number;
  /** Lifecycle script names declared in package.json. They are never executed. */
  lifecycleScripts: string[];
  issues: ValidationIssue[];
  installable: boolean;
}
