import { useState } from 'react';
import { CheckCircle2, CircleDashed, ExternalLink, Lock } from 'lucide-react';
import type { AgentId } from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { agentName, SCOPE_LABELS } from '../lib/format';
import { useApp } from '../state/app-state';
import { ValidationBadge } from '../components/skill-badges';
import { SkillDetail } from '../components/SkillDetail';
import { Badge, Callout, Card, CardHeader, EmptyState, Mono, Spinner } from '../components/ui';

export function Agents() {
  const { inventory, scanning } = useApp();
  const [agent, setAgent] = useState<AgentId>('claude');
  const [selected, setSelected] = useState<string | null>(null);
  if (!inventory)
    return scanning ? <Spinner label="Scanning…" /> : <EmptyState title="No inventory yet" />;

  const detection = inventory.agents.find((a) => a.agentId === agent);
  const skills = inventory.skills.filter((s) => s.availability.some((a) => a.agentId === agent));

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Agents"
        className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
      >
        {AGENT_IDS.map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={agent === id}
            onClick={() => setAgent(id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${agent === id ? 'bg-accent text-accent-fg' : 'hover:bg-surface-3'}`}
          >
            {agentName(id)} <span className="opacity-70">({inventory.stats.perAgent[id]})</span>
          </button>
        ))}
      </div>

      {detection && (
        <>
          <Card>
            <CardHeader
              title={detection.displayName}
              subtitle={`Paths verified against official documentation on ${detection.pathsVerifiedOn}`}
              actions={
                detection.detected ? <Badge tone="ok">Detected</Badge> : <Badge>Not detected</Badge>
              }
            />
            <div className="space-y-3 p-4 text-sm">
              {detection.evidence.length > 0 ? (
                <p className="text-muted">
                  Evidence:{' '}
                  {detection.evidence.map((e) => (
                    <Mono key={e} className="mr-2">
                      {e}
                    </Mono>
                  ))}
                </p>
              ) : (
                <p className="text-muted">
                  No configuration directory or skill folder for this agent was found.
                </p>
              )}
              {detection.diagnostics.map((d) => (
                <Callout
                  key={d.code + (d.path ?? '')}
                  tone={d.level === 'error' ? 'bad' : d.level === 'warning' ? 'warn' : 'info'}
                  title={d.message}
                />
              ))}
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {detection.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                {detection.docsUrls.map((u) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <ExternalLink className="size-3.5" /> {new URL(u).hostname}
                    {new URL(u).pathname}
                  </a>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Skill locations"
              subtitle="Directories this agent reads. Missing directories are not created by a scan."
            />
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-2 py-2 font-medium">Scope</th>
                  <th className="px-2 py-2 font-medium">Relation</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Skills</th>
                </tr>
              </thead>
              <tbody>
                {detection.roots.map((r) => (
                  <tr key={r.root.id} className="border-t border-border align-top">
                    <td className="px-4 py-2">
                      <p className="font-medium">{r.root.label}</p>
                      <Mono className="text-muted">{r.root.path}</Mono>
                      {r.root.note && <p className="text-xs text-muted">{r.root.note}</p>}
                    </td>
                    <td className="px-2 py-2">{SCOPE_LABELS[r.root.scope]}</td>
                    <td className="px-2 py-2">
                      <Badge tone={r.root.relation === 'native' ? 'accent' : 'neutral'}>
                        {r.root.relation}
                      </Badge>
                      {!r.root.installable && (
                        <span
                          className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted"
                          title="Not an installation target"
                        >
                          <Lock className="size-3" /> read-only
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {!r.exists ? (
                        <span className="inline-flex items-center gap-1 text-muted">
                          <CircleDashed className="size-3.5" /> missing
                        </span>
                      ) : !r.readable ? (
                        <span className="text-bad">{r.error ?? 'unreadable'}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-ok">
                          <CheckCircle2 className="size-3.5" /> present
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.skillCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardHeader title={`Skills available to ${detection.displayName}`} />
            {skills.length === 0 ? (
              <EmptyState title="No skills found for this agent" />
            ) : (
              <ul className="divide-y divide-border">
                {skills.map((s) => {
                  const a = s.availability.find((x) => x.agentId === agent);
                  return (
                    <li
                      key={s.id}
                      className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="font-medium hover:text-accent"
                          onClick={() => setSelected(s.id)}
                        >
                          {s.name}
                        </button>
                        <p className="text-xs text-muted">Why: {a?.reason}</p>
                      </div>
                      <ValidationBadge state={s.validation.state} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
      <SkillDetail skillId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
