import type {
  AgentDescriptor,
  InstallScope,
  RootStatus,
  SkillRoot,
  ValidationIssue,
} from '@skillscope/shared';
import { customRoots, installRootsFor, makeRoot, rootDiagnostics, uniqueRoots } from '../common.js';
import type { AdapterContext, AgentAdapter, SkillForCompatibility } from '../types.js';

const DOCS = 'https://code.claude.com/docs/en/skills';

export const CLAUDE_DESCRIPTOR: AgentDescriptor = {
  id: 'claude',
  displayName: 'Claude Code',
  docsUrls: [DOCS, 'https://code.claude.com/docs/en/settings'],
  pathsVerifiedOn: '2026-10-21',
  notes: [
    'Personal skills live in ~/.claude/skills/<name>/SKILL.md; CLAUDE_CONFIG_DIR relocates ~/.claude.',
    'Project skills live in <project>/.claude/skills/<name>/SKILL.md. Nested .claude/skills folders in subdirectories are not scanned.',
    '~/.claude/skills/synced holds skills synced from claude.ai and is managed by Claude Code (read-only here).',
    'Plugin-provided skills are managed by the Claude Code plugin system and are not scanned.',
    'All frontmatter fields are optional for Claude Code; name defaults to the directory name.',
  ],
};

/** Characters Claude Code rejects in skill names (see the skills documentation). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[<>\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u00a0]/;
const DESCRIPTION_LISTING_LIMIT = 1536;

function configDir(ctx: AdapterContext): string {
  const override = ctx.platform.env.CLAUDE_CONFIG_DIR;
  if (override && ctx.platform.path.isAbsolute(override)) return override;
  return ctx.platform.path.join(ctx.platform.homeDir, '.claude');
}

function managedDir(ctx: AdapterContext): { path: string; verified: boolean } | null {
  const p = ctx.platform.path;
  switch (ctx.platform.platform) {
    case 'linux':
      return { path: '/etc/claude-code', verified: true };
    case 'darwin':
      return { path: '/Library/Application Support/ClaudeCode', verified: false };
    case 'win32': {
      const programFiles = ctx.platform.env.ProgramFiles ?? 'C:\\Program Files';
      return { path: p.join(programFiles, 'ClaudeCode'), verified: false };
    }
  }
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  descriptor: CLAUDE_DESCRIPTOR,
  operations: ['discover', 'install', 'update', 'remove'],

  roots(ctx) {
    const p = ctx.platform.path;
    const base = configDir(ctx);
    const roots: SkillRoot[] = [
      makeRoot('claude', {
        key: 'personal',
        scope: 'global',
        path: p.join(base, 'skills'),
        relation: 'native',
        label: 'Personal skills (~/.claude/skills)',
        maxDepth: 1,
        installable: true,
        docsUrl: DOCS,
      }),
      makeRoot('claude', {
        key: 'synced',
        scope: 'global',
        path: p.join(base, 'skills', 'synced'),
        relation: 'native',
        label: 'Synced from claude.ai (~/.claude/skills/synced)',
        maxDepth: 1,
        installable: false,
        docsUrl: DOCS,
        note: 'Managed by Claude Code. Do not edit by hand.',
      }),
    ];
    if (ctx.workspaceRoot) {
      roots.push(
        makeRoot('claude', {
          key: 'project',
          scope: 'project',
          path: p.join(ctx.workspaceRoot, '.claude', 'skills'),
          relation: 'native',
          label: 'Project skills (.claude/skills)',
          maxDepth: 1,
          installable: true,
          docsUrl: DOCS,
        }),
      );
    }
    const managed = managedDir(ctx);
    if (ctx.includeSystemRoots && managed) {
      roots.push(
        makeRoot('claude', {
          key: 'enterprise',
          scope: 'system',
          path: p.join(managed.path, '.claude', 'skills'),
          relation: 'native',
          label: 'Enterprise (managed) skills',
          maxDepth: 1,
          installable: false,
          docsUrl: DOCS,
          note: managed.verified
            ? 'Deployed by your organization.'
            : 'Deployed by your organization. This platform path is inferred and not confirmed by the documentation.',
        }),
      );
    }
    return uniqueRoots(ctx, [...roots, ...customRoots('claude', ctx)]);
  },

  evidencePaths(ctx) {
    const p = ctx.platform.path;
    return [configDir(ctx), p.join(ctx.platform.homeDir, '.claude.json')];
  },

  installRoots(ctx, scope: InstallScope) {
    return installRootsFor(this.roots(ctx), scope);
  },

  checkCompatibility(skill: SkillForCompatibility): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const name = skill.name ?? skill.directoryName;
    if (FORBIDDEN_NAME_CHARS.test(name) || name !== name.trim() || /\s{2,}/.test(name)) {
      issues.push({
        code: 'compat.claude.name-characters',
        severity: 'error',
        category: 'compatibility',
        agentId: 'claude',
        message: `Claude Code does not load skills whose name contains "<", ">", control, invisible or irregular whitespace characters ("${name}").`,
        hint: 'Rename the skill using plain characters.',
      });
    }
    if (
      skill.directoryName.toLowerCase() === 'anthropic-skills' ||
      name.startsWith('anthropic-skills:')
    ) {
      issues.push({
        code: 'compat.claude.reserved-name',
        severity: 'error',
        category: 'compatibility',
        agentId: 'claude',
        message:
          'The "anthropic-skills" namespace is reserved for synced skills and will not load.',
        hint: 'Rename the skill directory.',
      });
    }
    const description =
      typeof skill.frontmatter.description === 'string' ? skill.frontmatter.description : '';
    const whenToUse =
      typeof skill.frontmatter.when_to_use === 'string' ? skill.frontmatter.when_to_use : '';
    if (!description) {
      issues.push({
        code: 'compat.claude.description-recommended',
        severity: 'info',
        category: 'compatibility',
        agentId: 'claude',
        message:
          'Claude Code recommends a description; without one it falls back to the first line of the body.',
        hint: 'Add a "description" that says what the skill does and when to use it.',
      });
    } else if (description.length + whenToUse.length > DESCRIPTION_LISTING_LIMIT) {
      issues.push({
        code: 'compat.claude.description-truncated',
        severity: 'warning',
        category: 'compatibility',
        agentId: 'claude',
        message: `Claude Code truncates description + when_to_use beyond ${DESCRIPTION_LISTING_LIMIT} characters in the skill listing.`,
        hint: 'Put the key use case first or shorten the description.',
      });
    }
    return issues;
  },

  diagnose(_ctx, statuses: RootStatus[]) {
    return rootDiagnostics(statuses);
  },
};
