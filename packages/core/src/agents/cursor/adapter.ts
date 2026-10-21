import type {
  AgentDescriptor,
  InstallScope,
  RootStatus,
  SkillRoot,
  ValidationIssue,
} from '@skillscope/shared';
import {
  customRoots,
  installRootsFor,
  makeRoot,
  rootDiagnostics,
  strictNameChecks,
  uniqueRoots,
} from '../common.js';
import type { AdapterContext, AgentAdapter, SkillForCompatibility } from '../types.js';

const DOCS = 'https://cursor.com/docs/context/skills';

export const CURSOR_DESCRIPTOR: AgentDescriptor = {
  id: 'cursor',
  displayName: 'Cursor',
  docsUrls: [DOCS],
  pathsVerifiedOn: '2026-10-21',
  notes: [
    'Native locations: ~/.cursor/skills and ~/.agents/skills (user), .cursor/skills and .agents/skills (project).',
    'Compatibility locations: ~/.claude/skills, ~/.codex/skills, .claude/skills and .codex/skills.',
    'Cursor walks skill roots recursively, so category folders are supported.',
    'Nested project folders such as apps/web/.cursor/skills are not scanned; only the workspace root is.',
    'Skills found in compatibility locations are reported as available to Cursor, not as Cursor installs.',
  ],
};

function cursorEvidence(ctx: AdapterContext): string[] {
  const p = ctx.platform.path;
  const home = ctx.platform.homeDir;
  const paths = [p.join(home, '.cursor')];
  if (ctx.platform.platform === 'win32') {
    const appData = ctx.platform.env.APPDATA ?? p.join(home, 'AppData', 'Roaming');
    paths.push(p.join(appData, 'Cursor'));
  } else if (ctx.platform.platform === 'darwin') {
    paths.push(p.join(home, 'Library', 'Application Support', 'Cursor'));
  } else {
    const config = ctx.platform.env.XDG_CONFIG_HOME ?? p.join(home, '.config');
    paths.push(p.join(config, 'Cursor'));
  }
  return paths;
}

export const cursorAdapter: AgentAdapter = {
  id: 'cursor',
  descriptor: CURSOR_DESCRIPTOR,
  operations: ['discover', 'install', 'update', 'remove'],

  roots(ctx) {
    const p = ctx.platform.path;
    const home = ctx.platform.homeDir;
    const depth = Math.max(1, ctx.maxDepth);
    const roots: SkillRoot[] = [
      makeRoot('cursor', {
        key: 'user-cursor',
        scope: 'global',
        path: p.join(home, '.cursor', 'skills'),
        relation: 'native',
        label: 'User skills (~/.cursor/skills)',
        maxDepth: depth,
        installable: true,
        docsUrl: DOCS,
      }),
      makeRoot('cursor', {
        key: 'user-agents',
        scope: 'global',
        path: p.join(home, '.agents', 'skills'),
        relation: 'native',
        label: 'Shared user skills (~/.agents/skills)',
        maxDepth: depth,
        installable: true,
        docsUrl: DOCS,
        note: 'Shared Agent Skills directory; Codex reads it too.',
      }),
      makeRoot('cursor', {
        key: 'compat-claude',
        scope: 'global',
        path: p.join(home, '.claude', 'skills'),
        relation: 'compatible',
        label: 'Claude Code skills (~/.claude/skills)',
        maxDepth: depth,
        installable: false,
        docsUrl: DOCS,
      }),
      makeRoot('cursor', {
        key: 'compat-codex',
        scope: 'global',
        path: p.join(home, '.codex', 'skills'),
        relation: 'compatible',
        label: 'Codex legacy skills (~/.codex/skills)',
        maxDepth: depth,
        installable: false,
        docsUrl: DOCS,
      }),
    ];
    if (ctx.workspaceRoot) {
      const ws = ctx.workspaceRoot;
      roots.push(
        makeRoot('cursor', {
          key: 'project-cursor',
          scope: 'project',
          path: p.join(ws, '.cursor', 'skills'),
          relation: 'native',
          label: 'Project skills (.cursor/skills)',
          maxDepth: depth,
          installable: true,
          docsUrl: DOCS,
        }),
        makeRoot('cursor', {
          key: 'project-agents',
          scope: 'project',
          path: p.join(ws, '.agents', 'skills'),
          relation: 'native',
          label: 'Shared project skills (.agents/skills)',
          maxDepth: depth,
          installable: true,
          docsUrl: DOCS,
          note: 'Shared Agent Skills directory; Codex reads it too.',
        }),
        makeRoot('cursor', {
          key: 'project-compat-claude',
          scope: 'project',
          path: p.join(ws, '.claude', 'skills'),
          relation: 'compatible',
          label: 'Claude Code project skills (.claude/skills)',
          maxDepth: depth,
          installable: false,
          docsUrl: DOCS,
        }),
        makeRoot('cursor', {
          key: 'project-compat-codex',
          scope: 'project',
          path: p.join(ws, '.codex', 'skills'),
          relation: 'compatible',
          label: 'Codex project skills (.codex/skills)',
          maxDepth: depth,
          installable: false,
          docsUrl: DOCS,
        }),
      );
    }
    return uniqueRoots(ctx, [...roots, ...customRoots('cursor', ctx)]);
  },

  evidencePaths(ctx) {
    return cursorEvidence(ctx);
  },

  installRoots(ctx, scope: InstallScope) {
    return installRootsFor(this.roots(ctx), scope);
  },

  checkCompatibility(skill: SkillForCompatibility): ValidationIssue[] {
    const issues = strictNameChecks('cursor', skill, 'Cursor');
    const description = skill.frontmatter.description;
    if (skill.hasFrontmatter && (typeof description !== 'string' || description.trim() === '')) {
      issues.push({
        code: 'compat.cursor.description-required',
        severity: 'warning',
        category: 'compatibility',
        agentId: 'cursor',
        message: 'Cursor requires a "description" in SKILL.md frontmatter.',
        hint: 'Add a description so Cursor can decide when the skill is relevant.',
      });
    }
    if ('globs' in skill.frontmatter && !('paths' in skill.frontmatter)) {
      issues.push({
        code: 'compat.cursor.legacy-globs',
        severity: 'info',
        category: 'compatibility',
        agentId: 'cursor',
        message: 'Cursor still accepts the legacy "globs" field, but "paths" is preferred.',
        hint: 'Rename "globs" to "paths".',
      });
    }
    return issues;
  },

  diagnose(_ctx, statuses: RootStatus[]) {
    return rootDiagnostics(statuses);
  },
};
