import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Bot, Copy, Layers, Share2 } from 'lucide-react';
import type { OperationRecord } from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { call } from '../lib/api';
import { agentName, plural, relativeTime } from '../lib/format';
import { useApp } from '../state/app-state';
import { Badge, Card, CardHeader, EmptyState, Spinner } from '../components/ui';
import type { Page } from '../App';

function Stat({
  label,
  value,
  sub,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="flex flex-col items-start rounded-lg border border-border bg-surface-2 p-4 text-left transition enabled:hover:border-accent/60"
    >
      <div className="flex w-full items-center justify-between text-muted">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <span
        className="mt-2 text-2xl font-semibold tabular-nums"
        data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {value}
      </span>
      {sub && <span className="mt-0.5 text-xs text-muted">{sub}</span>}
    </Tag>
  );
}

const STATE_TONE = {
  succeeded: 'ok',
  failed: 'bad',
  'rolled-back': 'warn',
  running: 'info',
  cancelled: 'neutral',
} as const;

export function Dashboard({ navigate }: { navigate: (page: Page) => void }) {
  const { inventory, scanning } = useApp();
  const [operations, setOperations] = useState<OperationRecord[]>([]);

  useEffect(() => {
    void call('operations:list', { limit: 8 })
      .then(setOperations)
      .catch(() => setOperations([]));
  }, [inventory?.generatedAt]);

  if (!inventory) {
    return scanning ? (
      <Spinner label="Scanning skill directories…" />
    ) : (
      <EmptyState title="No inventory yet" />
    );
  }
  const { stats } = inventory;
  const maxPerAgent = Math.max(1, ...AGENT_IDS.map((a) => stats.perAgent[a]));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat
          label="Unique skills"
          value={stats.uniqueSkills}
          sub={`${stats.availabilityRecords} agent availability records`}
          icon={<Layers className="size-4" />}
          onClick={() => navigate('inventory')}
        />
        <Stat
          label="Agents detected"
          value={stats.detectedAgents}
          sub={`of ${AGENT_IDS.length} supported`}
          icon={<Bot className="size-4" />}
          onClick={() => navigate('agents')}
        />
        <Stat
          label="Shared skills"
          value={stats.sharedSkills}
          sub="read by more than one agent"
          icon={<Share2 className="size-4" />}
        />
        <Stat
          label="Duplicate groups"
          value={stats.duplicateGroups}
          sub="same content or same name"
          icon={<Copy className="size-4" />}
          onClick={() => navigate('validation')}
        />
        <Stat
          label="Problems"
          value={stats.problematicSkills}
          sub="invalid skills"
          icon={<AlertTriangle className="size-4" />}
          onClick={() => navigate('validation')}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Skills available to each agent"
            subtitle="A shared skill counts once per agent that can discover it."
          />
          <ul className="space-y-3 p-4">
            {AGENT_IDS.map((id) => {
              const agent = inventory.agents.find((a) => a.agentId === id);
              const count = stats.perAgent[id];
              return (
                <li key={id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      {agentName(id)}
                      {agent?.detected ? (
                        <Badge tone="ok">Detected</Badge>
                      ) : (
                        <Badge>Not detected</Badge>
                      )}
                    </span>
                    <span className="tabular-nums text-muted" data-testid={`agent-count-${id}`}>
                      {plural(count, 'skill')}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded bg-surface-3">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${(count / maxPerAgent) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            subtitle={`Last scan ${relativeTime(inventory.generatedAt)}${inventory.fromCache ? ' (cached)' : ''}`}
          />
          {operations.length === 0 ? (
            <EmptyState icon={<Activity className="size-5" />} title="No activity yet" />
          ) : (
            <ul className="divide-y divide-border">
              {operations.map((op) => (
                <li
                  key={op.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate">{op.summary}</p>
                    <p className="text-xs text-muted">
                      {op.kind} · {relativeTime(op.startedAt)}
                    </p>
                  </div>
                  <Badge tone={STATE_TONE[op.state]}>{op.state}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-muted">
        Counts come from the filesystem scan. Finding a skill on disk does not prove that an agent
        has loaded or run it.
      </p>
    </div>
  );
}
