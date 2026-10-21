import type { InventorySnapshot } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import type { AdapterContext } from '../agents/types.js';
import { discoverSkills } from '../discovery/discover.js';
import { buildInventory, type ManagedLookup } from './build.js';

export interface ScanInventoryOptions {
  followSymlinks: boolean;
  managed?: ManagedLookup;
}

/** Discover and normalise every skill visible to the registered agents. Read-only. */
export async function scanInventory(
  registry: AdapterRegistry,
  ctx: AdapterContext,
  options: ScanInventoryOptions,
): Promise<InventorySnapshot> {
  const startedAt = Date.now();
  const discovery = await discoverSkills(registry, ctx, { followSymlinks: options.followSymlinks });
  const input: Parameters<typeof buildInventory>[0] = {
    ctx: ctx.platform,
    registry,
    sightings: discovery.sightings,
    agents: discovery.agents,
    roots: discovery.roots,
    workspaceRoot: ctx.workspaceRoot,
    startedAt,
  };
  if (options.managed) input.managed = options.managed;
  return buildInventory(input);
}
