import { readFile } from 'node:fs/promises';
import type { AgentId, InspectedSkill, ValidationIssue } from '@skillscope/shared';
import { AGENT_IDS, MANIFEST_FILE_NAME, parseAgentSkillManifest } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import { readSkillTree } from '../inventory/files.js';
import type { PlatformContext } from '../platform/context.js';
import { validateSkill } from '../validation/validator.js';
import type { ArchiveFile } from './tarball.js';

/** npm lifecycle scripts. SkillScope records them for display and never runs them. */
export const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'preuninstall',
  'uninstall',
  'postuninstall',
] as const;

export interface DeclaredSkill {
  name: string;
  path: string;
  agents: AgentId[];
  description: string | null;
}

export interface LayoutResult {
  source: 'agent-skill.json' | 'none';
  schemaVersion: number | null;
  skills: DeclaredSkill[];
  issues: ValidationIssue[];
}

function packageIssue(
  code: string,
  severity: ValidationIssue['severity'],
  message: string,
  hint: string,
): ValidationIssue {
  return { code, severity, category: 'structure', message, hint };
}

/**
 * Work out which skills a package contains. With `agent-skill.json` the manifest is the only
 * authority. Without it, only the unambiguous `skills/<name>/SKILL.md` layout is accepted and
 * flagged so the user knows nothing was declared.
 */
export function resolveLayout(files: ArchiveFile[]): LayoutResult {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const manifestFile = byPath.get(MANIFEST_FILE_NAME);
  if (manifestFile) {
    const parsed = parseAgentSkillManifest(manifestFile.data.toString('utf8'));
    if (!parsed.manifest) {
      return {
        source: 'agent-skill.json',
        schemaVersion: null,
        skills: [],
        issues: parsed.errors.map((e) =>
          packageIssue(
            'package.manifest-invalid',
            'error',
            `agent-skill.json: ${e}`,
            'Ask the package maintainer to fix agent-skill.json.',
          ),
        ),
      };
    }
    const issues: ValidationIssue[] = [];
    const skills: DeclaredSkill[] = [];
    for (const s of parsed.manifest.skills) {
      if (!byPath.has(`${s.path}/SKILL.md`)) {
        issues.push(
          packageIssue(
            'package.skill-md-missing',
            'error',
            `Declared skill "${s.name}" has no SKILL.md at ${s.path}/SKILL.md.`,
            'The package is incomplete; try another version.',
          ),
        );
        continue;
      }
      skills.push({
        name: s.name,
        path: s.path,
        agents: s.agents,
        description: s.description ?? null,
      });
    }
    return {
      source: 'agent-skill.json',
      schemaVersion: parsed.manifest.schemaVersion,
      skills,
      issues,
    };
  }

  const candidates = files
    .map((f) => /^skills\/([^/]+)\/SKILL\.md$/.exec(f.path)?.[1])
    .filter((n): n is string => Boolean(n));
  const otherSkillMd = files.filter(
    (f) => /(^|\/)SKILL\.md$/i.test(f.path) && !/^skills\/[^/]+\/SKILL\.md$/.test(f.path),
  );
  if (candidates.length === 0) {
    return {
      source: 'none',
      schemaVersion: null,
      skills: [],
      issues: [
        packageIssue(
          'package.not-a-skill-package',
          'error',
          otherSkillMd.length > 0
            ? 'The package contains SKILL.md files but no agent-skill.json and no skills/<name>/SKILL.md layout, so it is ambiguous which files to install.'
            : 'The package has no agent-skill.json and no skills, so it is not a skill package.',
          'Only packages that follow the SkillScope package contract can be installed.',
        ),
      ],
    };
  }
  if (otherSkillMd.length > 0) {
    return {
      source: 'none',
      schemaVersion: null,
      skills: [],
      issues: [
        packageIssue(
          'package.ambiguous-layout',
          'error',
          `Without agent-skill.json, SKILL.md files outside skills/<name>/ (${otherSkillMd.map((f) => f.path).join(', ')}) make the layout ambiguous.`,
          'Ask the maintainer to add agent-skill.json.',
        ),
      ],
    };
  }
  return {
    source: 'none',
    schemaVersion: null,
    skills: candidates.map((name) => ({
      name,
      path: `skills/${name}`,
      agents: [],
      description: null,
    })),
    issues: [
      packageIssue(
        'package.manifest-missing',
        'warning',
        'No agent-skill.json: skills were detected from the skills/<name>/SKILL.md layout and no agent compatibility is declared.',
        'Choose target agents yourself and review each skill before installing.',
      ),
    ],
  };
}

export function lifecycleScripts(files: ArchiveFile[]): string[] {
  const pkg = files.find((f) => f.path === 'package.json');
  if (!pkg) return [];
  try {
    const scripts =
      (JSON.parse(pkg.data.toString('utf8')) as { scripts?: Record<string, unknown> }).scripts ??
      {};
    return LIFECYCLE_SCRIPTS.filter((s) => typeof scripts[s] === 'string');
  } catch {
    return [];
  }
}

/** Validate each declared skill from the staged copy on disk. */
export async function inspectStagedSkills(
  ctx: PlatformContext,
  registry: AdapterRegistry,
  stagedDir: string,
  layout: LayoutResult,
): Promise<InspectedSkill[]> {
  const out: InspectedSkill[] = [];
  for (const declared of layout.skills) {
    const dir = ctx.path.join(stagedDir, ...declared.path.split('/'));
    const tree = await readSkillTree(dir, ctx);
    const skillFile = tree.files.find((f) => f.path === 'SKILL.md');
    const content = skillFile ? await readFile(ctx.path.join(dir, 'SKILL.md'), 'utf8') : null;
    const agents = declared.agents.length ? declared.agents : [...AGENT_IDS];
    const result = validateSkill({
      directoryName: declared.name,
      skillFileName: skillFile ? 'SKILL.md' : null,
      content,
      files: tree.files,
      caseSensitive: true,
      adapters: agents.map((a) => registry.get(a)),
    });
    const issues = [...result.report.issues];
    if (result.name !== null && result.name !== declared.name) {
      issues.push({
        code: 'package.name-mismatch',
        severity: 'error',
        category: 'metadata',
        message: `agent-skill.json names the skill "${declared.name}" but its SKILL.md says "${result.name}".`,
        hint: 'The package is inconsistent; ask the maintainer to fix it.',
      });
    }
    out.push({
      name: declared.name,
      path: declared.path,
      declaredAgents: declared.agents,
      description: result.description ?? declared.description,
      validation: {
        state: issues.some((i) => i.severity === 'error') ? 'invalid' : result.report.state,
        issues,
      },
      files: tree.files.map(({ path, size, kind }) => ({ path, size, kind })),
      skillMd: content ?? '',
      contentHash: tree.contentHash,
    });
  }
  return out;
}
