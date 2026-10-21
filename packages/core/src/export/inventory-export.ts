import type { ExportFormat, InventorySnapshot } from '@skillscope/shared';
import { AGENT_DISPLAY_NAMES } from '@skillscope/shared';

export const EXPORT_SCHEMA = 'skillscope.inventory/v1';

export interface ExportedSkill {
  id: string;
  name: string;
  description: string | null;
  path: string;
  realPath: string;
  scope: string;
  agents: { agent: string; relation: string; root: string; reason: string }[];
  sharedLocation: boolean;
  validation: string;
  errors: number;
  warnings: number;
  statuses: string[];
  package: { name: string; version: string } | null;
  contentHash: string;
  modifiedAt: string;
}

export interface InventoryExport {
  schema: typeof EXPORT_SCHEMA;
  generatedAt: string;
  exportedAt: string;
  platform: string;
  workspaceRoot: string | null;
  note: string;
  stats: InventorySnapshot['stats'];
  skills: ExportedSkill[];
}

const NOTE =
  'Skills were detected on disk. Detection does not prove that an agent has loaded or executed a skill.';

export function toExport(snapshot: InventorySnapshot, now = new Date()): InventoryExport {
  return {
    schema: EXPORT_SCHEMA,
    generatedAt: snapshot.generatedAt,
    exportedAt: now.toISOString(),
    platform: snapshot.platform,
    workspaceRoot: snapshot.workspaceRoot,
    note: NOTE,
    stats: snapshot.stats,
    skills: snapshot.skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      path: s.path,
      realPath: s.realPath,
      scope: s.scope,
      agents: s.availability.map((a) => ({
        agent: a.agentId,
        relation: a.relation,
        root: a.rootPath,
        reason: a.reason,
      })),
      sharedLocation: s.sharedLocation,
      validation: s.validation.state,
      errors: s.validation.issues.filter((i) => i.severity === 'error').length,
      warnings: s.validation.issues.filter((i) => i.severity === 'warning').length,
      statuses: s.statuses,
      package: s.package ? { name: s.package.name, version: s.package.version } : null,
      contentHash: s.contentHash,
      modifiedAt: s.modifiedAt,
    })),
  };
}

/** RFC 4180 quoting plus protection against spreadsheet formula injection. */
export function csvCell(value: string | number | boolean | null): string {
  let s = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  'name',
  'description',
  'agents',
  'scope',
  'shared_location',
  'validation',
  'errors',
  'warnings',
  'package',
  'version',
  'path',
  'content_hash',
  'modified_at',
] as const;

export function toCsv(data: InventoryExport): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const s of data.skills) {
    rows.push(
      [
        s.name,
        s.description,
        s.agents
          .map((a) => `${a.agent}${a.relation === 'compatible' ? ' (compatible)' : ''}`)
          .join('; '),
        s.scope,
        s.sharedLocation,
        s.validation,
        s.errors,
        s.warnings,
        s.package?.name ?? '',
        s.package?.version ?? '',
        s.path,
        s.contentHash,
        s.modifiedAt,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}

function mdCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function toMarkdown(data: InventoryExport): string {
  const lines = [
    '# SkillScope inventory report',
    '',
    `- Generated: ${data.generatedAt}`,
    `- Platform: ${data.platform}`,
    `- Workspace: ${data.workspaceRoot ?? 'none'}`,
    `- Unique skills: ${data.stats.uniqueSkills}`,
    `- Agent availability records: ${data.stats.availabilityRecords}`,
    ...Object.entries(data.stats.perAgent).map(
      ([agent, n]) =>
        `- ${AGENT_DISPLAY_NAMES[agent as keyof typeof AGENT_DISPLAY_NAMES]}: ${n} skills available`,
    ),
    `- Shared skills: ${data.stats.sharedSkills}`,
    `- Duplicate groups: ${data.stats.duplicateGroups}`,
    `- Invalid skills: ${data.stats.problematicSkills}`,
    '',
    `> ${data.note}`,
    '',
    '| Name | Agents | Scope | Validation | Package | Path |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const s of data.skills) {
    lines.push(
      `| ${[
        s.name,
        s.agents
          .map((a) => a.agent + (a.relation === 'compatible' ? ' (compatible)' : ''))
          .join(', '),
        s.scope,
        s.validation,
        s.package ? `${s.package.name}@${s.package.version}` : 'external',
        `\`${s.path.replace(/`/g, "'")}\``,
      ]
        .map(mdCell)
        .join(' | ')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function exportInventory(
  snapshot: InventorySnapshot,
  format: ExportFormat,
  now = new Date(),
): string {
  const data = toExport(snapshot, now);
  if (format === 'csv') return toCsv(data);
  if (format === 'markdown') return toMarkdown(data);
  return `${JSON.stringify(data, null, 2)}\n`;
}

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  json: 'json',
  csv: 'csv',
  markdown: 'md',
};
