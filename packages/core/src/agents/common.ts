import type {
  AdapterDiagnostic,
  AgentId,
  InstallScope,
  RootRelation,
  RootStatus,
  SkillRoot,
  SkillScopeKind,
  ValidationIssue,
} from '@skillscope/shared';
import { SKILL_NAME_PATTERN } from '@skillscope/shared';
import { expandUserPath, pathKey } from '../platform/context.js';
import type { AdapterContext, SkillForCompatibility } from './types.js';

export interface RootSpec {
  key: string;
  scope: SkillScopeKind;
  path: string;
  relation: RootRelation;
  label: string;
  maxDepth: number;
  installable: boolean;
  docsUrl?: string;
  note?: string;
}

export function makeRoot(agentId: AgentId, spec: RootSpec): SkillRoot {
  const root: SkillRoot = {
    id: `${agentId}:${spec.scope}:${spec.key}`,
    agentId,
    scope: spec.scope,
    path: spec.path,
    relation: spec.relation,
    label: spec.label,
    maxDepth: spec.maxDepth,
    installable: spec.installable && spec.scope !== 'system',
    source: 'builtin',
  };
  if (spec.docsUrl) root.docsUrl = spec.docsUrl;
  if (spec.note) root.note = spec.note;
  return root;
}

/** Turn the user's custom locations for an agent into roots. Project paths need a workspace. */
export function customRoots(agentId: AgentId, ctx: AdapterContext): SkillRoot[] {
  const out: SkillRoot[] = [];
  for (const loc of ctx.customLocations) {
    if (loc.agentId !== agentId) continue;
    let resolved: string;
    const expanded = expandUserPath(ctx.platform, loc.path);
    if (ctx.platform.path.isAbsolute(expanded)) {
      resolved = expanded;
    } else if (loc.scope === 'project' && ctx.workspaceRoot) {
      resolved = ctx.platform.path.join(ctx.workspaceRoot, expanded);
    } else {
      continue;
    }
    out.push({
      id: `${agentId}:custom:${loc.id}`,
      agentId,
      scope: loc.scope,
      path: resolved,
      relation: 'native',
      label: loc.label,
      maxDepth: Math.max(1, ctx.maxDepth),
      installable: loc.installable,
      source: 'custom',
      note: 'Custom location added in Settings.',
    });
  }
  return out;
}

/** De-duplicate roots that resolve to the same directory, keeping the first occurrence. */
export function uniqueRoots(ctx: AdapterContext, roots: SkillRoot[]): SkillRoot[] {
  const seen = new Set<string>();
  return roots.filter((r) => {
    const key = pathKey(ctx.platform, r.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function installRootsFor(roots: SkillRoot[], scope: InstallScope): SkillRoot[] {
  // Native, built-in roots first so the default target is the agent's own directory.
  return roots.filter((r) => r.installable && r.scope === scope).sort((a, b) => rank(a) - rank(b));
}

function rank(root: SkillRoot): number {
  if (root.source === 'builtin' && root.relation === 'native') return 0;
  if (root.source === 'custom') return 1;
  return 2;
}

/** Portable checks shared by agents that follow the Agent Skills format strictly. */
export function strictNameChecks(
  agentId: AgentId,
  skill: SkillForCompatibility,
  agentName: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!skill.hasFrontmatter) return issues;
  if (!skill.name) {
    issues.push({
      code: 'compat.name-required',
      severity: 'warning',
      category: 'compatibility',
      agentId,
      message: `${agentName} requires a "name" field in SKILL.md frontmatter.`,
      hint: 'Add a name that matches the skill directory, e.g. "name: my-skill".',
    });
    return issues;
  }
  if (!SKILL_NAME_PATTERN.test(skill.name)) {
    issues.push({
      code: 'compat.name-format',
      severity: 'warning',
      category: 'compatibility',
      agentId,
      message: `${agentName} expects lowercase letters, digits and hyphens in skill names; "${skill.name}" may not load.`,
      hint: 'Rename the skill using lowercase letters, digits and single hyphens.',
    });
  }
  if (skill.name !== skill.directoryName) {
    issues.push({
      code: 'compat.name-directory-mismatch',
      severity: 'warning',
      category: 'compatibility',
      agentId,
      message: `${agentName} expects the skill name "${skill.name}" to match its directory "${skill.directoryName}".`,
      hint: 'Rename the directory or the frontmatter name so they match.',
    });
  }
  return issues;
}

export function rootDiagnostics(statuses: RootStatus[]): AdapterDiagnostic[] {
  const out: AdapterDiagnostic[] = [];
  for (const s of statuses) {
    if (s.exists && !s.readable) {
      out.push({
        level: 'error',
        code: 'root.unreadable',
        message: `Cannot read ${s.root.label}: ${s.error ?? 'permission denied'}.`,
        path: s.root.path,
      });
    }
  }
  const anyExists = statuses.some((s) => s.exists);
  if (!anyExists) {
    out.push({
      level: 'info',
      code: 'root.none-exist',
      message:
        'None of the skill directories for this agent exist yet. They are not created during a scan.',
    });
  }
  return out;
}
