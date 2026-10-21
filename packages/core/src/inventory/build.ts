import { readFile, stat } from 'node:fs/promises';
import type {
  AgentAvailability,
  AgentDetection,
  AgentId,
  DuplicateGroup,
  InventorySnapshot,
  InventoryStats,
  RootStatus,
  SkillRecord,
  SkillRoot,
  SkillStatus,
} from '@skillscope/shared';
import { AGENT_DISPLAY_NAMES, AGENT_IDS } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import type { SkillSighting } from '../discovery/discover.js';
import { pathKey, type PlatformContext } from '../platform/context.js';
import { validateSkill, SKILL_MD_MAX_BYTES } from '../validation/validator.js';
import { readSkillTree, sha256Hex } from './files.js';

/** What the persistence layer knows about a SkillScope-managed installation at a path. */
export interface ManagedInstallInfo {
  receiptId: string;
  packageName: string;
  version: string;
  contentHash: string;
}

export type ManagedLookup = (realPathKey: string) => ManagedInstallInfo | null;

export interface BuildInventoryInput {
  ctx: PlatformContext;
  registry: AdapterRegistry;
  sightings: SkillSighting[];
  agents: AgentDetection[];
  roots: RootStatus[];
  workspaceRoot: string | null;
  managed?: ManagedLookup;
  now?: Date;
  startedAt?: number;
}

export function skillIdFor(ctx: PlatformContext, realDir: string): string {
  return `sk_${sha256Hex(pathKey(ctx, realDir)).slice(0, 20)}`;
}

function reasonFor(root: SkillRoot): string {
  const agent = AGENT_DISPLAY_NAMES[root.agentId];
  if (root.relation === 'compatible') {
    return `${agent} also reads ${root.label} as a compatibility location (${root.path}).`;
  }
  if (root.source === 'custom')
    return `${agent} is configured to read the custom location ${root.path}.`;
  return `${agent} reads ${root.label} (${root.path}).`;
}

const SCOPE_RANK = { project: 0, global: 1, system: 2 } as const;

/**
 * Turn per-root sightings into one normalised record per physical skill directory. Multiple
 * agents seeing the same directory produce availability records, not duplicate skills.
 */
export async function buildInventory(input: BuildInventoryInput): Promise<InventorySnapshot> {
  const { ctx } = input;
  const now = input.now ?? new Date();
  const groups = new Map<string, SkillSighting[]>();
  for (const sighting of input.sightings) {
    const key = pathKey(ctx, sighting.skill.realDir);
    const list = groups.get(key) ?? [];
    list.push(sighting);
    groups.set(key, list);
  }

  const records: SkillRecord[] = [];
  for (const [realKey, sightings] of groups) {
    const primary = [...sightings].sort((a, b) => {
      const nativeA = a.root.relation === 'native' ? 0 : 1;
      const nativeB = b.root.relation === 'native' ? 0 : 1;
      return nativeA - nativeB || SCOPE_RANK[a.root.scope] - SCOPE_RANK[b.root.scope];
    })[0] as SkillSighting;
    const { skill } = primary;

    const availability: AgentAvailability[] = [];
    const seenAgents = new Set<AgentId>();
    for (const s of sightings) {
      if (seenAgents.has(s.root.agentId)) continue;
      seenAgents.add(s.root.agentId);
      availability.push({
        agentId: s.root.agentId,
        rootId: s.root.id,
        rootPath: s.root.path,
        scope: s.root.scope,
        relation: s.root.relation,
        reason: reasonFor(s.root),
      });
    }
    availability.sort((a, b) => AGENT_IDS.indexOf(a.agentId) - AGENT_IDS.indexOf(b.agentId));

    const tree = await readSkillTree(skill.dir, ctx);
    let content: string | null = null;
    let readError: string | null = null;
    if (skill.skillFile) {
      try {
        const st = await stat(skill.skillFile);
        content =
          st.size > SKILL_MD_MAX_BYTES * 4
            ? (await readFile(skill.skillFile, 'utf8')).slice(0, SKILL_MD_MAX_BYTES * 4)
            : await readFile(skill.skillFile, 'utf8');
      } catch (error) {
        readError = (error as Error).message;
      }
    }
    const directoryName = ctx.path.basename(skill.dir);
    const validation = validateSkill({
      directoryName,
      skillFileName: skill.skillFileName,
      content,
      readError,
      files: tree.files,
      caseSensitive: !ctx.caseInsensitive,
      adapters: availability.map((a) => input.registry.get(a.agentId)),
    });

    const managedInfo = input.managed?.(realKey) ?? null;
    const management = !managedInfo
      ? 'external'
      : managedInfo.contentHash === tree.contentHash
        ? 'managed'
        : 'modified';

    records.push({
      id: skillIdFor(ctx, skill.realDir),
      name: validation.name ?? directoryName,
      directoryName,
      description: validation.description,
      frontmatter: validation.parsed?.frontmatter ?? {},
      path: skill.dir,
      realPath: skill.realDir,
      isSymlink: skill.isSymlink,
      scope: primary.root.scope,
      availability,
      contentHash: tree.contentHash,
      fileCount: tree.fileCount,
      totalBytes: tree.totalBytes,
      modifiedAt: new Date(tree.latestMtimeMs || now.getTime()).toISOString(),
      detectedAt: now.toISOString(),
      validation: validation.report,
      statuses: [],
      sharedLocation: availability.length > 1,
      duplicateGroupIds: [],
      management,
      package: managedInfo
        ? {
            name: managedInfo.packageName,
            version: managedInfo.version,
            receiptId: managedInfo.receiptId,
          }
        : null,
    });
  }

  records.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  const duplicateGroups = findDuplicates(records);
  for (const record of records) record.statuses = statusesFor(record, duplicateGroups);

  const snapshot: InventorySnapshot = {
    generatedAt: now.toISOString(),
    platform: ctx.platform,
    workspaceRoot: input.workspaceRoot,
    skills: records,
    agents: input.agents,
    roots: input.roots,
    duplicateGroups,
    stats: computeStats(records, input.agents, duplicateGroups),
    fromCache: false,
    scanDurationMs: input.startedAt ? Date.now() - input.startedAt : 0,
  };
  return snapshot;
}

/** Identical content in different directories, and the same name with different content. */
export function findDuplicates(records: SkillRecord[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const byHash = new Map<string, SkillRecord[]>();
  const byName = new Map<string, SkillRecord[]>();
  for (const r of records) {
    if (r.validation.issues.some((i) => i.code === 'structure.missing-skill-md')) continue;
    byHash.set(r.contentHash, [...(byHash.get(r.contentHash) ?? []), r]);
    const nameKey = r.name.toLowerCase();
    byName.set(nameKey, [...(byName.get(nameKey) ?? []), r]);
  }
  for (const [hash, list] of byHash) {
    if (list.length < 2) continue;
    const group: DuplicateGroup = {
      id: `dup_c_${hash.slice(0, 12)}`,
      kind: 'content',
      key: hash,
      skillIds: list.map((r) => r.id),
    };
    groups.push(group);
    list.forEach((r) => r.duplicateGroupIds.push(group.id));
  }
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    if (new Set(list.map((r) => r.contentHash)).size < 2) continue; // already a pure content duplicate
    const group: DuplicateGroup = {
      id: `dup_n_${sha256Hex(name).slice(0, 12)}`,
      kind: 'name',
      key: name,
      skillIds: list.map((r) => r.id),
    };
    groups.push(group);
    list.forEach((r) => r.duplicateGroupIds.push(group.id));
  }
  return groups;
}

export function statusesFor(record: SkillRecord, groups: DuplicateGroup[]): SkillStatus[] {
  const out: SkillStatus[] = ['detected'];
  const codes = record.validation.issues.filter((i) => i.severity === 'error').map((i) => i.code);
  if (codes.includes('structure.missing-skill-md')) out.push('missing-required-file');
  if (codes.some((c) => c.startsWith('metadata.'))) out.push('invalid-metadata');
  if (record.validation.state !== 'invalid') out.push('valid');
  if (record.sharedLocation) out.push('shared-location');
  const mine = groups.filter((g) => record.duplicateGroupIds.includes(g.id));
  if (mine.some((g) => g.kind === 'content')) out.push('duplicate-content');
  if (mine.some((g) => g.kind === 'name')) out.push('duplicate-name');
  if (record.management === 'external') out.push('installed-external');
  else out.push('installed-skillscope');
  if (record.management === 'modified') out.push('changes-detected');
  out.push('runtime-unverified');
  return out;
}

export function computeStats(
  records: SkillRecord[],
  agents: AgentDetection[],
  groups: DuplicateGroup[],
): InventoryStats {
  const perAgent = Object.fromEntries(AGENT_IDS.map((id) => [id, 0])) as Record<AgentId, number>;
  let availabilityRecords = 0;
  for (const r of records) {
    for (const a of r.availability) {
      perAgent[a.agentId] += 1;
      availabilityRecords += 1;
    }
  }
  return {
    uniqueSkills: records.length,
    availabilityRecords,
    perAgent,
    detectedAgents: agents.filter((a) => a.detected).length,
    sharedSkills: records.filter((r) => r.sharedLocation).length,
    duplicateGroups: groups.length,
    problematicSkills: records.filter((r) => r.validation.state === 'invalid').length,
  };
}
