import { useEffect, useState, type ReactNode } from 'react';
import type { OperationRecord } from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { call } from '../lib/api';
import { agentName, plural, relativeTime } from '../lib/format';
import { useApp } from '../state/app-state';
import { LANE, ReachLegend, ReachMap } from '../components/Reach';
import { SkillDetail } from '../components/SkillDetail';
import { Badge, EmptyState, Spinner } from '../components/ui';
import type { Page } from '../App';

const STATE_TONE = {
  succeeded: 'ok',
  failed: 'bad',
  'rolled-back': 'warn',
  running: 'info',
  cancelled: 'neutral',
} as const;

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-t border-rule pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TextLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-medium text-accent hover:underline"
    >
      {children}
    </button>
  );
}

export function Dashboard({ navigate }: { navigate: (page: Page) => void }) {
  const { inventory, scanning } = useApp();
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void call('operations:list', { limit: 6 })
      .then(setOperations)
      .catch(() => setOperations([]));
  }, [inventory?.generatedAt]);

  if (!inventory) {
    return scanning ? (
      <Spinner label="Reading your skill folders…" />
    ) : (
      <EmptyState title="No inventory yet" />
    );
  }
  const { stats, skills } = inventory;
  const invalid = skills.filter((s) => s.validation.state === 'invalid');

  return (
    <div className="max-w-6xl space-y-8">
      <header className="max-w-3xl">
        <h1 className="text-display font-semibold tracking-[-0.02em] text-balance">
          <span className="tabular" data-testid="stat-unique-skills">
            {stats.uniqueSkills}
          </span>{' '}
          {stats.uniqueSkills === 1 ? 'skill' : 'skills'} on disk, reachable{' '}
          <span className="tabular" data-testid="stat-availability">
            {stats.availabilityRecords}
          </span>{' '}
          {stats.availabilityRecords === 1 ? 'time' : 'times'} across{' '}
          {plural(stats.detectedAgents, 'detected agent')}.
        </h1>
        <p className="mt-2 max-w-[68ch] text-base text-muted">
          A skill in a folder that several agents read is one copy on disk and one entry per agent.
          The map shows which agent can find each skill, and through which folder.
        </p>
      </header>

      {skills.length === 0 ? (
        <EmptyState title="No skills found in any supported folder">
          Install one from the Marketplace, or add a custom folder in Settings if you keep skills
          somewhere else.
        </EmptyState>
      ) : (
        <section aria-label="Reach map" className="space-y-3">
          <ReachMap skills={skills} onSelect={setSelected} />
          <ReachLegend />
        </section>
      )}

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-3">
        <Section
          title="By agent"
          action={<TextLink onClick={() => navigate('agents')}>Open agents</TextLink>}
        >
          <ul className="space-y-3">
            {AGENT_IDS.map((id) => {
              const agent = inventory.agents.find((a) => a.agentId === id);
              const own = skills.filter((s) =>
                s.availability.some((a) => a.agentId === id && a.relation === 'native'),
              ).length;
              const compat = stats.perAgent[id] - own;
              return (
                <li key={id} className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className={`font-medium ${LANE[id].text}`}>{agentName(id)}</p>
                    <p className="text-xs text-muted">
                      {agent?.detected
                        ? `${own} in its own folders, ${compat} via compatibility folders`
                        : 'Not detected on this computer'}
                    </p>
                  </div>
                  <span className="tabular text-lg font-semibold" data-testid={`agent-count-${id}`}>
                    {plural(stats.perAgent[id], 'skill')}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section
          title="Needs attention"
          action={<TextLink onClick={() => navigate('validation')}>Open validation</TextLink>}
        >
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>Invalid skills</dt>
            <dd className={`tabular font-semibold ${stats.problematicSkills ? 'text-bad' : ''}`}>
              {stats.problematicSkills}
            </dd>
            <dt>Duplicate groups</dt>
            <dd className={`tabular font-semibold ${stats.duplicateGroups ? 'text-warn' : ''}`}>
              {stats.duplicateGroups}
            </dd>
            <dt>In folders shared by several agents</dt>
            <dd className="tabular font-semibold">{stats.sharedSkills}</dd>
          </dl>
          {invalid.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {invalid.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="text-left hover:text-accent"
                    onClick={() => setSelected(s.id)}
                  >
                    {s.name}
                    <span className="block text-xs text-muted">
                      {s.validation.issues[0]?.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Recent activity"
          action={
            <span className="text-xs text-muted">
              Scanned {relativeTime(inventory.generatedAt)}
            </span>
          }
        >
          {operations.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing yet. Scans, installs and removals will be listed here.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {operations.map((op) => (
                <li key={op.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{op.summary}</p>
                    <p className="text-xs text-muted">{relativeTime(op.startedAt)}</p>
                  </div>
                  <Badge tone={STATE_TONE[op.state]}>{op.state}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <p className="max-w-[68ch] text-xs text-muted">
        Everything here comes from reading the folders on disk. Finding a skill does not prove that
        an agent has loaded or run it.
      </p>
      <SkillDetail skillId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
