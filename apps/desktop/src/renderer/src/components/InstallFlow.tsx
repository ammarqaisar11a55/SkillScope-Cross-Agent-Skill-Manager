import { useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type {
  AgentId,
  InstallPlan,
  InstallResult,
  InstallScope,
  PackageInspection,
} from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { call, errorText } from '../lib/api';
import { agentName } from '../lib/format';
import { useApp } from '../state/app-state';
import { ValidationBadge } from './skill-badges';
import { IssueList } from './IssueList';
import { OperationProgressBar } from './OperationProgressBar';
import { Badge, Button, Callout, ErrorCallout, Modal, Mono } from './ui';

const CHANGE_TONE = {
  added: 'ok',
  removed: 'bad',
  modified: 'warn',
  unchanged: 'neutral',
} as const;

export function InspectionSummary({ inspection }: { inspection: PackageInspection }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {inspection.integrity.verified ? (
          <Badge tone="ok">
            <ShieldCheck className="size-3" /> Integrity verified ({inspection.integrity.algorithm})
          </Badge>
        ) : (
          <Badge tone="bad">Integrity not verified</Badge>
        )}
        <Badge tone={inspection.manifestSource === 'agent-skill.json' ? 'accent' : 'warn'}>
          {inspection.manifestSource === 'agent-skill.json'
            ? `agent-skill.json v${inspection.schemaVersion}`
            : 'No agent-skill.json'}
        </Badge>
        <Badge>{inspection.files.length} files</Badge>
        {inspection.installable ? (
          <Badge tone="ok">Installable</Badge>
        ) : (
          <Badge tone="bad">Not installable</Badge>
        )}
      </div>
      {inspection.issues.length > 0 && <IssueList issues={inspection.issues} />}
      <ul className="space-y-2">
        {inspection.skills.map((s) => (
          <li key={s.name} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.name}</span>
              <ValidationBadge state={s.validation.state} />
              <span className="text-xs text-muted">from {s.path}/</span>
              <span className="ml-auto flex gap-1">
                {s.declaredAgents.length === 0 ? (
                  <Badge tone="warn">No agents declared</Badge>
                ) : (
                  s.declaredAgents.map((a) => (
                    <Badge key={a} tone="accent" title="Declared by the package; not a guarantee">
                      {agentName(a)}
                    </Badge>
                  ))
                )}
              </span>
            </div>
            {s.description && <p className="mt-1 text-muted">{s.description}</p>}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-accent">
                SKILL.md and {s.files.length} file(s)
              </summary>
              <ul className="mt-1 text-xs text-muted">
                {s.files.map((f) => (
                  <li key={f.path}>
                    <Mono>{f.path}</Mono>
                  </li>
                ))}
              </ul>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 font-mono text-xs">
                {s.skillMd}
              </pre>
            </details>
            {s.validation.issues.length > 0 && (
              <div className="mt-2">
                <IssueList issues={s.validation.issues} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Target selection → plan review → explicit confirmation → install. */
export function InstallFlow({
  inspection,
  onDone,
}: {
  inspection: PackageInspection;
  onDone: () => void;
}) {
  const { settings } = useApp();
  const installable = inspection.skills.filter((s) => s.validation.state !== 'invalid');
  const [skills, setSkills] = useState<string[]>(installable.map((s) => s.name));
  const [agents, setAgents] = useState<AgentId[]>(() => {
    const declared = new Set(installable.flatMap((s) => s.declaredAgents));
    return declared.size ? AGENT_IDS.filter((a) => declared.has(a)) : [];
  });
  const [scope, setScope] = useState<InstallScope>(
    settings?.defaultScope === 'project' && settings.workspaceRoot ? 'project' : 'global',
  );
  const [shared, setShared] = useState(false);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  const conflicts = useMemo(() => plan?.targets.filter((t) => t.conflict) ?? [], [plan]);
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan(
        await call('install:plan', {
          stagingId: inspection.stagingId,
          skills,
          targets: agents.map((agentId) => ({ agentId, scope })),
          allowSharedInstall: shared,
        }),
      );
      setConfirmed(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async (policy: 'abort' | 'replace') => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await call('install:execute', { planId: plan.id, conflictPolicy: policy, confirmed }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!inspection.installable) {
    return (
      <Callout tone="bad" title="This package cannot be installed">
        Resolve the issues above or choose another version.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Skills</legend>
        <div className="flex flex-wrap gap-3">
          {installable.map((s) => (
            <label key={s.name} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={skills.includes(s.name)}
                onChange={() => setSkills(toggle(skills, s.name))}
              />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Target agents</legend>
        <div className="flex flex-wrap gap-3">
          {AGENT_IDS.map((a) => (
            <label key={a} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                data-testid={`target-${a}`}
                checked={agents.includes(a)}
                onChange={() => setAgents(toggle(agents, a))}
              />
              {agentName(a)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Scope</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={scope === 'global'} onChange={() => setScope('global')} />{' '}
            Global (your user)
          </label>
          <label
            className={`flex items-center gap-1.5 ${settings?.workspaceRoot ? '' : 'opacity-50'}`}
          >
            <input
              type="radio"
              disabled={!settings?.workspaceRoot}
              checked={scope === 'project'}
              onChange={() => setScope('project')}
            />{' '}
            Project
            {settings?.workspaceRoot ? (
              <Mono className="text-muted">{settings.workspaceRoot}</Mono>
            ) : (
              <span className="text-xs text-muted">(select a workspace in Settings)</span>
            )}
          </label>
        </div>
      </fieldset>
      {agents.includes('codex') && agents.includes('cursor') && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
          <span>
            Install one shared copy for Codex and Cursor in <Mono>.agents/skills</Mono>
            <span className="block text-xs text-muted">
              Both agents officially read this folder. Leave unchecked to install a separate copy
              for each agent.
            </span>
          </span>
        </label>
      )}
      <ErrorCallout error={error} />
      <Button
        variant="primary"
        busy={busy && !plan}
        disabled={skills.length === 0 || agents.length === 0}
        onClick={() => void review()}
      >
        Review installation
      </Button>

      <Modal
        open={plan !== null}
        wide
        title={
          result ? 'Installation complete' : `Install ${inspection.name}@${inspection.version}`
        }
        onClose={() => {
          setPlan(null);
          if (result) onDone();
        }}
        footer={
          result ? (
            <Button
              variant="primary"
              onClick={() => {
                setPlan(null);
                onDone();
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setPlan(null)}>Cancel</Button>
              {conflicts.length > 0 ? (
                <Button
                  variant="danger"
                  busy={busy}
                  disabled={!confirmed}
                  onClick={() => void install('replace')}
                >
                  Replace existing (backup kept)
                </Button>
              ) : (
                <Button
                  variant="primary"
                  busy={busy}
                  disabled={!confirmed}
                  onClick={() => void install('abort')}
                  data-testid="confirm-install"
                >
                  Install
                </Button>
              )}
            </>
          )
        }
      >
        {plan && !result && (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1">Skill</th>
                  <th>Agents</th>
                  <th>Destination</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {plan.targets.map((t) => (
                  <tr key={t.id} className="border-t border-border align-top">
                    <td className="py-2 font-medium">{t.skillName}</td>
                    <td className="py-2">{t.agentIds.map(agentName).join(', ')}</td>
                    <td className="py-2">
                      <Mono>{t.destination}</Mono>
                      {t.note && <p className="text-xs text-muted">{t.note}</p>}
                    </td>
                    <td className="py-2">
                      {t.conflict ? (
                        <div>
                          <Badge tone="warn">
                            <AlertTriangle className="size-3" />{' '}
                            {t.conflict.kind === 'external'
                              ? 'Existing skill'
                              : t.conflict.kind === 'not-a-directory'
                                ? 'A file exists here'
                                : 'Installed by SkillScope'}
                          </Badge>
                          {t.conflict.identical && (
                            <p className="text-xs text-muted">Identical content</p>
                          )}
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {t.conflict.diff
                              .filter((d) => d.change !== 'unchanged')
                              .map((d) => (
                                <li key={d.path}>
                                  <Badge tone={CHANGE_TONE[d.change]}>{d.change}</Badge>{' '}
                                  <Mono>{d.path}</Mono>
                                </li>
                              ))}
                          </ul>
                        </div>
                      ) : (
                        <Badge tone="ok">New</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {conflicts.length > 0 && (
              <Callout tone="warn" title="Existing content will be replaced only if you confirm">
                The current folders are moved to a backup first and can be restored from the
                Installation Manager. To avoid replacing, cancel and choose another scope or agent.
              </Callout>
            )}
            {plan.warnings.map((w) => (
              <Callout key={w} tone="warn">
                {w}
              </Callout>
            ))}
            <OperationProgressBar kinds={['install']} />
            <ErrorCallout error={error} />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                data-testid="confirm-checkbox"
              />
              I reviewed the targets and understand that these skills are third-party instructions
              and scripts that can influence my coding agents.
            </label>
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <Callout
              tone="ok"
              title={`Installed ${result.receipts.length} skill cop${result.receipts.length === 1 ? 'y' : 'ies'}`}
            >
              Detection on disk does not prove that each agent has loaded the skill; restart or
              reload the agent if needed.
            </Callout>
            <ul className="space-y-1 text-sm">
              {result.receipts.map((r) => (
                <li key={r.id}>
                  {r.skillName} → {r.agentIds.map(agentName).join(', ')}:{' '}
                  <Mono>{r.destination}</Mono>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
