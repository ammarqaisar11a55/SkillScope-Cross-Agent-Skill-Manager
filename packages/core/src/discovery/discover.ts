import { stat } from 'node:fs/promises';
import type { AgentDetection, RootStatus, SkillRoot } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import type { AdapterContext } from '../agents/types.js';
import { pathKey } from '../platform/context.js';
import { scanPath, type DiscoveredSkillDir, type PathScanResult } from './scanner.js';

/** A skill directory as seen through one agent's root. */
export interface SkillSighting {
  root: SkillRoot;
  skill: DiscoveredSkillDir;
}

export interface DiscoveryResult {
  agents: AgentDetection[];
  roots: RootStatus[];
  sightings: SkillSighting[];
  warnings: string[];
}

export interface DiscoveryOptions {
  followSymlinks: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover skills for every registered agent. Each physical directory is scanned once (to the
 * deepest depth any agent needs) and its results are attributed to each agent root that covers it.
 */
export async function discoverSkills(
  registry: AdapterRegistry,
  ctx: AdapterContext,
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const adapters = registry.all();
  const rootsByAgent = new Map(adapters.map((a) => [a.id, a.roots(ctx)] as const));
  const allRoots = [...rootsByAgent.values()].flat();
  const knownRootKeys = new Set(allRoots.map((r) => pathKey(ctx.platform, r.path)));

  const depthByPath = new Map<string, { path: string; depth: number }>();
  for (const root of allRoots) {
    const key = pathKey(ctx.platform, root.path);
    const current = depthByPath.get(key);
    depthByPath.set(key, { path: root.path, depth: Math.max(current?.depth ?? 0, root.maxDepth) });
  }

  const scans = new Map<string, PathScanResult>();
  await Promise.all(
    [...depthByPath.entries()].map(async ([key, { path, depth }]) => {
      scans.set(
        key,
        await scanPath(path, {
          ctx: ctx.platform,
          maxDepth: depth,
          followSymlinks: options.followSymlinks,
          knownRootKeys,
        }),
      );
    }),
  );

  const sightings: SkillSighting[] = [];
  const statuses: RootStatus[] = [];
  const agents: AgentDetection[] = [];
  const warnings = new Set<string>();

  for (const adapter of adapters) {
    const roots = rootsByAgent.get(adapter.id) ?? [];
    const agentStatuses: RootStatus[] = [];
    for (const root of roots) {
      const scan = scans.get(pathKey(ctx.platform, root.path));
      if (!scan) continue;
      const visible = scan.skills.filter((s) => s.depth <= root.maxDepth);
      for (const skill of visible) sightings.push({ root, skill });
      scan.warnings.forEach((w) => warnings.add(w));
      const status: RootStatus = {
        root,
        exists: scan.exists,
        readable: scan.readable,
        skillCount: visible.filter((s) => s.skillFile !== null).length,
      };
      if (scan.error) status.error = scan.error;
      agentStatuses.push(status);
    }
    statuses.push(...agentStatuses);

    const evidence: string[] = [];
    for (const candidate of adapter.evidencePaths(ctx)) {
      if (await exists(candidate)) evidence.push(candidate);
    }
    for (const s of agentStatuses) if (s.exists) evidence.push(s.root.path);

    agents.push({
      agentId: adapter.id,
      displayName: adapter.descriptor.displayName,
      detected: evidence.length > 0,
      evidence: [...new Set(evidence)],
      roots: agentStatuses,
      diagnostics: adapter.diagnose(ctx, agentStatuses),
      docsUrls: adapter.descriptor.docsUrls,
      pathsVerifiedOn: adapter.descriptor.pathsVerifiedOn,
      notes: adapter.descriptor.notes,
    });
  }

  return { agents, roots: statuses, sightings, warnings: [...warnings] };
}
