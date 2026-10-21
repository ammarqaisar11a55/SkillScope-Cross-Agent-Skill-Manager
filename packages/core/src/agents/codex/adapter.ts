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

const DOCS = 'https://learn.chatgpt.com/docs/build-skills';

export const CODEX_DESCRIPTOR: AgentDescriptor = {
  id: 'codex',
  displayName: 'OpenAI Codex',
  docsUrls: [DOCS],
  pathsVerifiedOn: '2026-10-21',
  notes: [
    'User skills live in $HOME/.agents/skills; repository skills in .agents/skills from the working directory up to the repository root.',
    'Only the selected workspace root is scanned for repository skills, not every parent or subfolder.',
    'Admin skills live in /etc/codex/skills (documented for Linux/containers only).',
    'System skills bundled with Codex have no filesystem location and are not listed.',
    'SKILL.md frontmatter must include name and description.',
    '~/.codex/skills is not a documented Codex location and is not treated as one.',
  ],
};

function codexHome(ctx: AdapterContext): string {
  const override = ctx.platform.env.CODEX_HOME;
  if (override && ctx.platform.path.isAbsolute(override)) return override;
  return ctx.platform.path.join(ctx.platform.homeDir, '.codex');
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  descriptor: CODEX_DESCRIPTOR,
  operations: ['discover', 'install', 'update', 'remove'],

  roots(ctx) {
    const p = ctx.platform.path;
    const roots: SkillRoot[] = [
      makeRoot('codex', {
        key: 'user',
        scope: 'global',
        path: p.join(ctx.platform.homeDir, '.agents', 'skills'),
        relation: 'native',
        label: 'User skills ($HOME/.agents/skills)',
        maxDepth: 1,
        installable: true,
        docsUrl: DOCS,
        note: 'Shared Agent Skills directory; Cursor reads it too.',
      }),
    ];
    if (ctx.workspaceRoot) {
      roots.push(
        makeRoot('codex', {
          key: 'repo',
          scope: 'project',
          path: p.join(ctx.workspaceRoot, '.agents', 'skills'),
          relation: 'native',
          label: 'Repository skills (.agents/skills)',
          maxDepth: 1,
          installable: true,
          docsUrl: DOCS,
          note: 'Shared Agent Skills directory; Cursor reads it too.',
        }),
      );
    }
    if (ctx.includeSystemRoots && ctx.platform.platform !== 'win32') {
      roots.push(
        makeRoot('codex', {
          key: 'admin',
          scope: 'system',
          path: '/etc/codex/skills',
          relation: 'native',
          label: 'Admin skills (/etc/codex/skills)',
          maxDepth: 1,
          installable: false,
          docsUrl: DOCS,
        }),
      );
    }
    return uniqueRoots(ctx, [...roots, ...customRoots('codex', ctx)]);
  },

  evidencePaths(ctx) {
    return [codexHome(ctx)];
  },

  installRoots(ctx, scope: InstallScope) {
    return installRootsFor(this.roots(ctx), scope);
  },

  checkCompatibility(skill: SkillForCompatibility): ValidationIssue[] {
    const issues = strictNameChecks('codex', skill, 'Codex');
    const description = skill.frontmatter.description;
    if (skill.hasFrontmatter && (typeof description !== 'string' || description.trim() === '')) {
      issues.push({
        code: 'compat.codex.description-required',
        severity: 'warning',
        category: 'compatibility',
        agentId: 'codex',
        message: 'Codex requires a "description" in SKILL.md frontmatter.',
        hint: 'Add a description that says when the skill should and should not trigger.',
      });
    }
    if (skill.files.includes('agents/openai.yaml')) {
      issues.push({
        code: 'compat.codex.openai-yaml',
        severity: 'info',
        category: 'compatibility',
        agentId: 'codex',
        message:
          'agents/openai.yaml provides Codex-specific UI metadata and policy; other agents ignore it.',
        hint: 'No action needed.',
      });
    }
    return issues;
  },

  diagnose(_ctx, statuses: RootStatus[]) {
    return rootDiagnostics(statuses);
  },
};
