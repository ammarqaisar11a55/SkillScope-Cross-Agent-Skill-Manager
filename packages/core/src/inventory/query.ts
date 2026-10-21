import type { InventoryQuery, SkillRecord } from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';

function matchesText(skill: SkillRecord, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return (
    skill.name.toLowerCase().includes(needle) ||
    (skill.description ?? '').toLowerCase().includes(needle) ||
    skill.directoryName.toLowerCase().includes(needle)
  );
}

function firstAgentIndex(skill: SkillRecord): number {
  const indexes = skill.availability.map((a) => AGENT_IDS.indexOf(a.agentId));
  return indexes.length ? Math.min(...indexes) : AGENT_IDS.length;
}

/** Search, filter and sort inventory records. Pure: never mutates its input. */
export function queryInventory(
  skills: readonly SkillRecord[],
  query: InventoryQuery = {},
): SkillRecord[] {
  const filtered = skills.filter((s) => {
    if (query.text && !matchesText(s, query.text)) return false;
    if (query.agents?.length && !s.availability.some((a) => query.agents?.includes(a.agentId)))
      return false;
    if (query.scopes?.length && !query.scopes.includes(s.scope)) return false;
    if (query.validation?.length && !query.validation.includes(s.validation.state)) return false;
    if (query.source === 'npm' && !s.package) return false;
    if (query.source === 'external' && s.package) return false;
    return true;
  });
  const dir = query.direction === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'name';
  return filtered.sort((a, b) => {
    let cmp = 0;
    if (sort === 'agent') cmp = firstAgentIndex(a) - firstAgentIndex(b);
    else if (sort === 'modified') cmp = a.modifiedAt.localeCompare(b.modifiedAt);
    if (cmp === 0) cmp = a.name.localeCompare(b.name);
    if (cmp === 0) cmp = a.path.localeCompare(b.path);
    return cmp * dir;
  });
}
