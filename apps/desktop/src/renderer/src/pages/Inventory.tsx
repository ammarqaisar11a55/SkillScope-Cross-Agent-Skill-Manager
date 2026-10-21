import { useMemo, useState } from 'react';
import { ArrowDownUp, Download, Search } from 'lucide-react';
import type {
  AgentId,
  InventorySortKey,
  SkillRecord,
  SkillScopeKind,
  ValidationState,
} from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { call, errorText } from '../lib/api';
import { agentName } from '../lib/format';
import { useApp } from '../state/app-state';
import { ScopeBadge, StatusChips, ValidationBadge } from '../components/skill-badges';
import { ReachGlyph, ReachLegend } from '../components/Reach';
import { SkillDetail } from '../components/SkillDetail';
import {
  Button,
  Card,
  EmptyState,
  ErrorCallout,
  Mono,
  Spinner,
  inputClass,
} from '../components/ui';

type Filters = {
  text: string;
  agent: AgentId | 'all';
  scope: SkillScopeKind | 'all';
  validation: ValidationState | 'all';
  source: 'all' | 'npm' | 'external';
  sort: InventorySortKey;
  desc: boolean;
};

const INITIAL: Filters = {
  text: '',
  agent: 'all',
  scope: 'all',
  validation: 'all',
  source: 'all',
  sort: 'name',
  desc: false,
};

/** Same semantics as the core queryInventory(); kept local because the renderer cannot import core. */
export function applyFilters(skills: SkillRecord[], f: Filters): SkillRecord[] {
  const needle = f.text.trim().toLowerCase();
  const out = skills.filter(
    (s) =>
      (!needle ||
        s.name.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle)) &&
      (f.agent === 'all' || s.availability.some((a) => a.agentId === f.agent)) &&
      (f.scope === 'all' || s.scope === f.scope) &&
      (f.validation === 'all' || s.validation.state === f.validation) &&
      (f.source === 'all' || (f.source === 'npm' ? s.package !== null : s.package === null)),
  );
  const firstAgent = (s: SkillRecord) =>
    Math.min(...s.availability.map((a) => AGENT_IDS.indexOf(a.agentId)), 9);
  out.sort((a, b) => {
    let c = 0;
    if (f.sort === 'agent') c = firstAgent(a) - firstAgent(b);
    if (f.sort === 'modified') c = a.modifiedAt.localeCompare(b.modifiedAt);
    if (c === 0) c = a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
    return f.desc ? -c : c;
  });
  return out;
}

function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      className={`${inputClass} w-auto min-w-36`}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function Inventory() {
  const { inventory, scanning } = useApp();
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [selected, setSelected] = useState<string | null>(null);
  const [exportError, setExportError] = useState<{ message: string; hint?: string } | null>(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const rows = useMemo(() => applyFilters(inventory?.skills ?? [], filters), [inventory, filters]);

  const exportAs = async (format: 'json' | 'csv' | 'markdown') => {
    setExportError(null);
    try {
      await call('export:inventory', { format });
    } catch (e) {
      setExportError(errorText(e));
    }
  };

  if (!inventory)
    return scanning ? <Spinner label="Scanning…" /> : <EmptyState title="No inventory yet" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" />
          <input
            className={`${inputClass} w-full pl-8`}
            placeholder="Search name or description"
            aria-label="Search skills"
            value={filters.text}
            onChange={(e) => set('text', e.target.value)}
          />
        </div>
        <Select
          label="Agent"
          value={filters.agent}
          onChange={(v) => set('agent', v)}
          options={[
            ['all', 'All agents'],
            ...AGENT_IDS.map((a) => [a, agentName(a)] as [AgentId, string]),
          ]}
        />
        <Select
          label="Scope"
          value={filters.scope}
          onChange={(v) => set('scope', v)}
          options={[
            ['all', 'All scopes'],
            ['global', 'Global'],
            ['project', 'Project'],
            ['system', 'System'],
          ]}
        />
        <Select
          label="Validation"
          value={filters.validation}
          onChange={(v) => set('validation', v)}
          options={[
            ['all', 'Any status'],
            ['valid', 'Valid'],
            ['warnings', 'Warnings'],
            ['invalid', 'Invalid'],
          ]}
        />
        <Select
          label="Source"
          value={filters.source}
          onChange={(v) => set('source', v)}
          options={[
            ['all', 'Any source'],
            ['npm', 'npm (SkillScope)'],
            ['external', 'External'],
          ]}
        />
        <Select
          label="Sort"
          value={filters.sort}
          onChange={(v) => set('sort', v)}
          options={[
            ['name', 'Sort: name'],
            ['agent', 'Sort: agent'],
            ['modified', 'Sort: last change'],
          ]}
        />
        <Button
          variant="ghost"
          aria-label="Reverse sort order"
          icon={<ArrowDownUp className="size-4" />}
          onClick={() => set('desc', !filters.desc)}
        />
        <Button icon={<Download className="size-4" />} onClick={() => void exportAs('json')}>
          JSON
        </Button>
        <Button onClick={() => void exportAs('csv')}>CSV</Button>
        <Button onClick={() => void exportAs('markdown')}>Markdown</Button>
      </div>
      <ErrorCallout error={exportError} />
      <ReachLegend />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={
              inventory.skills.length === 0 ? 'No skills found' : 'No skills match these filters'
            }
          >
            {inventory.skills.length === 0
              ? 'SkillScope looked in every supported location for Claude Code, Codex and Cursor. Install a skill from the Marketplace or add a custom location in Settings.'
              : 'Clear the search or filters to see more.'}
          </EmptyState>
        ) : (
          <table className="w-full text-sm" data-testid="inventory-table">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Agents</th>
                <th className="px-2 py-2 font-medium">Scope</th>
                <th className="px-2 py-2 font-medium">Source</th>
                <th className="px-2 py-2 font-medium">Validation</th>
                <th className="px-2 py-2 font-medium">Version</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-t border-rule align-top hover:bg-surface-3/40">
                  <td className="max-w-80 px-4 py-2.5">
                    <button
                      type="button"
                      className="font-medium hover:text-accent"
                      onClick={() => setSelected(s.id)}
                    >
                      {s.name}
                    </button>
                    {s.description && (
                      <p className="line-clamp-2 text-xs text-muted">{s.description}</p>
                    )}
                    <Mono className="mt-1 block text-muted">{s.path}</Mono>
                    <div className="mt-1">
                      <StatusChips skill={s} />
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <ReachGlyph availability={s.availability} />
                  </td>
                  <td className="px-2 py-2.5">
                    <ScopeBadge scope={s.scope} />
                  </td>
                  <td className="px-2 py-2.5 text-xs">{s.package ? s.package.name : 'External'}</td>
                  <td className="px-2 py-2.5">
                    <ValidationBadge state={s.validation.state} />
                  </td>
                  <td className="px-2 py-2.5 text-xs">{s.package?.version ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" className="h-7" onClick={() => setSelected(s.id)}>
                      Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="text-xs text-muted">
        {rows.length} of {inventory.stats.uniqueSkills} unique skills ·{' '}
        {inventory.stats.availabilityRecords} agent availability records
      </p>
      <SkillDetail skillId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
