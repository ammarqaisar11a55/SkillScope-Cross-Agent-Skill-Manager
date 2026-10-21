import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type {
  AgentId,
  ConflictInfo,
  InstallPlan,
  InstallPlanRequest,
  PlannedTarget,
  SkillRoot,
} from '@skillscope/shared';
import { AGENT_DISPLAY_NAMES, SkillScopeError } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import type { AdapterContext } from '../agents/types.js';
import { readSkillTree } from '../inventory/files.js';
import type { StagedPackage } from '../packages/acquire.js';
import type { SkillScopeStore } from '../persistence/store.js';
import { exceedsPathLimit, isInside, pathKey } from '../platform/context.js';
import { diffTrees } from './diff.js';

export interface PlanContext {
  ctx: AdapterContext;
  registry: AdapterRegistry;
  store: SkillScopeStore;
}

/** Inspect what exists at a destination today, relative to the incoming skill. */
export async function detectConflict(
  plan: PlanContext,
  destination: string,
  incomingDir: string,
): Promise<ConflictInfo | null> {
  const p = plan.ctx.platform;
  const st = await lstat(destination).catch((error: { code?: string }) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!st) return null;
  const incoming = await readSkillTree(incomingDir, p);
  if (!st.isDirectory()) {
    return {
      kind: 'not-a-directory',
      existingPath: destination,
      existingHash: null,
      incomingHash: incoming.contentHash,
      identical: false,
      diff: [],
      receiptId: null,
    };
  }
  const existing = await readSkillTree(destination, p);
  const receipt = plan.store.activeReceiptAt(pathKey(p, destination));
  return {
    kind: !receipt
      ? 'external'
      : receipt.contentHash === existing.contentHash
        ? 'managed'
        : 'managed-modified',
    existingPath: destination,
    existingHash: existing.contentHash,
    incomingHash: incoming.contentHash,
    identical: existing.contentHash === incoming.contentHash,
    diff: diffTrees(existing.files, incoming.files),
    receiptId: receipt?.id ?? null,
  };
}

function chooseRoot(
  plan: PlanContext,
  agentId: AgentId,
  scope: 'global' | 'project',
  rootId: string | undefined,
): SkillRoot {
  if (scope === 'project' && !plan.ctx.workspaceRoot) {
    throw new SkillScopeError(
      'INVALID_REQUEST',
      'Select a project workspace in Settings before installing at project scope.',
    );
  }
  const roots = plan.registry.get(agentId).installRoots(plan.ctx, scope);
  if (roots.length === 0) {
    throw new SkillScopeError(
      'INVALID_REQUEST',
      `${AGENT_DISPLAY_NAMES[agentId]} has no ${scope} installation target.`,
    );
  }
  if (rootId) {
    const match = roots.find((r) => r.id === rootId);
    if (!match) {
      throw new SkillScopeError(
        'PATH_OUTSIDE_ROOT',
        `"${rootId}" is not an installation target for ${AGENT_DISPLAY_NAMES[agentId]}.`,
      );
    }
    return match;
  }
  return roots[0] as SkillRoot;
}

/**
 * Build an installation plan: one target per (skill, destination). Targets only merge when
 * several agents genuinely read the same directory and the user allowed a shared install.
 */
export async function planInstall(
  plan: PlanContext,
  staged: StagedPackage,
  request: InstallPlanRequest,
): Promise<InstallPlan> {
  const p = plan.ctx.platform;
  const { inspection } = staged;
  if (!inspection.installable) {
    throw new SkillScopeError(
      'VALIDATION_FAILED',
      'This package did not pass validation and cannot be installed.',
    );
  }
  const warnings: string[] = [
    'Skill instructions and bundled scripts are third-party content. They can influence what your coding agent does. Review them before use.',
  ];

  // Agents that share a root for a scope (e.g. Codex and Cursor both read ~/.agents/skills).
  const sharedRootFor = new Map<string, SkillRoot>();
  if (request.allowSharedInstall) {
    for (const scope of ['global', 'project'] as const) {
      const agents = request.targets
        .filter((t) => t.scope === scope && !t.rootId)
        .map((t) => t.agentId);
      if (agents.length < 2 || (scope === 'project' && !plan.ctx.workspaceRoot)) continue;
      const lists = agents.map((a) => plan.registry.get(a).installRoots(plan.ctx, scope));
      const common = (lists[0] ?? []).find((root) =>
        lists.every((l) => l.some((r) => pathKey(p, r.path) === pathKey(p, root.path))),
      );
      if (common)
        for (const a of agents)
          sharedRootFor.set(
            `${a}:${scope}`,
            plan.registry
              .get(a)
              .installRoots(plan.ctx, scope)
              .find((r) => pathKey(p, r.path) === pathKey(p, common.path)) as SkillRoot,
          );
    }
  }

  const targets: PlannedTarget[] = [];
  for (const skillName of request.skills) {
    const skill = inspection.skills.find((s) => s.name === skillName);
    if (!skill)
      throw new SkillScopeError(
        'NOT_FOUND',
        `The package does not contain a skill named "${skillName}".`,
      );
    if (skill.validation.state === 'invalid') {
      throw new SkillScopeError(
        'VALIDATION_FAILED',
        `The skill "${skillName}" is invalid and cannot be installed.`,
      );
    }
    const incomingDir = p.path.join(staged.dir, ...skill.path.split('/'));
    const byDestination = new Map<string, PlannedTarget>();

    for (const t of request.targets) {
      const root =
        sharedRootFor.get(`${t.agentId}:${t.scope}`) ??
        chooseRoot(plan, t.agentId, t.scope, t.rootId);
      const destination = p.path.join(root.path, skillName);
      if (!isInside(p, root.path, destination, false)) {
        throw new SkillScopeError(
          'PATH_OUTSIDE_ROOT',
          'The destination resolves outside the installation root.',
        );
      }
      if (skill.declaredAgents.length > 0 && !skill.declaredAgents.includes(t.agentId)) {
        warnings.push(
          `${skillName} does not declare support for ${AGENT_DISPLAY_NAMES[t.agentId]}; it may not work there as intended.`,
        );
      }
      if (exceedsPathLimit(p, p.path.join(destination, 'references', 'x'.repeat(40)))) {
        warnings.push(
          `The path ${destination} is close to the Windows 260-character limit; long file names inside the skill may fail.`,
        );
      }
      const key = pathKey(p, destination);
      const existing = byDestination.get(key);
      if (existing) {
        if (!existing.agentIds.includes(t.agentId)) existing.agentIds.push(t.agentId);
        existing.shared = existing.agentIds.length > 1;
        existing.note = `${existing.agentIds.map((a) => AGENT_DISPLAY_NAMES[a]).join(' and ')} all read ${root.path}; one copy serves them.`;
        continue;
      }
      byDestination.set(key, {
        id: `tgt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        skillName,
        agentIds: [t.agentId],
        scope: t.scope,
        rootId: root.id,
        rootPath: root.path,
        destination,
        shared: false,
        note: root.note ?? null,
        conflict: await detectConflict(plan, destination, incomingDir),
      });
    }
    targets.push(...byDestination.values());
  }

  return {
    id: `plan_${randomUUID().replace(/-/g, '')}`,
    stagingId: inspection.stagingId,
    packageName: inspection.name,
    version: inspection.version,
    integrity: inspection.integrity.expected,
    targets,
    warnings: [...new Set(warnings)],
    createdAt: new Date().toISOString(),
  };
}
