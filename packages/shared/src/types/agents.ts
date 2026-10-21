export const AGENT_IDS = ['claude', 'codex', 'cursor'] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_DISPLAY_NAMES: Readonly<Record<AgentId, string>> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  cursor: 'Cursor',
};

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Where a skill root applies.
 * - `global`: user-level, available in every project for the current OS user.
 * - `project`: inside the selected workspace.
 * - `system`: machine-wide/admin locations. Detected read-only; never an install target.
 */
export type SkillScopeKind = 'global' | 'project' | 'system';

export type InstallScope = Extract<SkillScopeKind, 'global' | 'project'>;

/**
 * - `native`: the agent's own documented skills directory.
 * - `compatible`: a directory that belongs to another agent (or the shared Agent Skills
 *   convention) which this agent also reads.
 */
export type RootRelation = 'native' | 'compatible';

export interface SkillRoot {
  /** Stable identifier: `<agent>:<scope>:<key>`. */
  id: string;
  agentId: AgentId;
  scope: SkillScopeKind;
  /** Absolute path of the directory that contains skill folders. */
  path: string;
  relation: RootRelation;
  label: string;
  /**
   * Maximum depth of skill directories below the root. `1` means `<root>/<skill>/SKILL.md`;
   * larger values allow category folders (`<root>/<category>/<skill>/SKILL.md`).
   */
  maxDepth: number;
  /** Whether SkillScope may install into this root. */
  installable: boolean;
  source: 'builtin' | 'custom';
  docsUrl?: string;
  note?: string;
}

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface AdapterDiagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  path?: string;
}

export interface RootStatus {
  root: SkillRoot;
  exists: boolean;
  readable: boolean;
  skillCount: number;
  error?: string;
}

export interface AgentDescriptor {
  id: AgentId;
  displayName: string;
  docsUrls: string[];
  /** ISO date on which the paths in the adapter were checked against official docs. */
  pathsVerifiedOn: string;
  notes: string[];
}

export interface AgentDetection {
  agentId: AgentId;
  displayName: string;
  /** True when any evidence of the agent exists (config directory or skill root). */
  detected: boolean;
  evidence: string[];
  roots: RootStatus[];
  diagnostics: AdapterDiagnostic[];
  docsUrls: string[];
  pathsVerifiedOn: string;
  notes: string[];
}
