import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { OperationRecord, ValidationSeverity } from '@skillscope/shared';
import { call } from '../lib/api';
import { formatDate } from '../lib/format';
import { useApp } from '../state/app-state';
import { IssueList } from '../components/IssueList';
import { SkillDetail } from '../components/SkillDetail';
import { ValidationBadge } from '../components/skill-badges';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Mono,
  Spinner,
} from '../components/ui';

type SeverityFilter = ValidationSeverity | 'all';

export function Validation() {
  const { inventory, scanning } = useApp();
  const [severity, setSeverity] = useState<SeverityFilter>('warning');
  const [selected, setSelected] = useState<string | null>(null);
  const [rejections, setRejections] = useState<OperationRecord[]>([]);

  useEffect(() => {
    void call('operations:list', { limit: 200 })
      .then((ops) =>
        setRejections(
          ops.filter((o) => o.state === 'failed' && (o.kind === 'install' || o.kind === 'update')),
        ),
      )
      .catch(() => setRejections([]));
  }, [inventory?.generatedAt]);

  const rank: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };
  const withIssues = useMemo(
    () =>
      (inventory?.skills ?? [])
        .map((s) => ({
          skill: s,
          issues: s.validation.issues.filter(
            (i) => severity === 'all' || rank[i.severity] <= rank[severity],
          ),
        }))
        .filter((x) => x.issues.length > 0)
        .sort(
          (a, b) => rank[a.issues[0]?.severity ?? 'info'] - rank[b.issues[0]?.severity ?? 'info'],
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inventory, severity],
  );

  if (!inventory)
    return scanning ? <Spinner label="Scanning…" /> : <EmptyState title="No inventory yet" />;
  const byId = new Map(inventory.skills.map((s) => [s.id, s]));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(['error', 'warning', 'all'] as const).map((s) => (
          <Button
            key={s}
            variant={severity === s ? 'primary' : 'secondary'}
            onClick={() => setSeverity(s)}
          >
            {s === 'error' ? 'Errors' : s === 'warning' ? 'Errors and warnings' : 'Everything'}
          </Button>
        ))}
      </div>

      {inventory.duplicateGroups.length > 0 && (
        <Card>
          <CardHeader
            title="Duplicates"
            subtitle="Identical copies in different folders, or the same name with different content."
          />
          <ul className="divide-y divide-border">
            {inventory.duplicateGroups.map((g) => (
              <li key={g.id} className="px-4 py-3 text-sm">
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone="warn">
                    {g.kind === 'content' ? 'Identical content' : 'Same name, different content'}
                  </Badge>
                  <span className="text-muted">
                    {g.kind === 'name' ? `"${g.key}"` : `hash ${g.key.slice(0, 12)}…`}
                  </span>
                </div>
                <ul className="space-y-1">
                  {g.skillIds.map((id) => {
                    const s = byId.get(id);
                    return s ? (
                      <li key={id}>
                        <button
                          type="button"
                          className="hover:text-accent"
                          onClick={() => setSelected(id)}
                        >
                          <Mono>{s.path}</Mono>
                        </button>
                      </li>
                    ) : null;
                  })}
                </ul>
                <p className="mt-1.5 text-xs text-muted">
                  Next step:{' '}
                  {g.kind === 'content'
                    ? 'keep one copy in a shared location, or leave both if each agent needs its own.'
                    : 'rename one skill so agents do not confuse them.'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rejections.length > 0 && (
        <Card>
          <CardHeader title="Rejected packages and failed installations" />
          <ul className="divide-y divide-border">
            {rejections.map((op) => (
              <li key={op.id} className="px-4 py-2.5 text-sm">
                <p className="font-medium">
                  {op.packageName}
                  {op.version ? `@${op.version}` : ''}{' '}
                  <span className="text-xs font-normal text-muted">{formatDate(op.startedAt)}</span>
                </p>
                <p className="text-bad">{op.error}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {withIssues.length === 0 ? (
        <Card>
          <EmptyState icon={<ShieldCheck className="size-6" />} title="No issues at this level">
            Every detected skill passed the selected checks.
          </EmptyState>
        </Card>
      ) : (
        withIssues.map(({ skill, issues }) => (
          <Card key={skill.id}>
            <CardHeader
              title={
                <button
                  type="button"
                  className="hover:text-accent"
                  onClick={() => setSelected(skill.id)}
                >
                  {skill.name}
                </button>
              }
              subtitle={<Mono>{skill.path}</Mono>}
              actions={<ValidationBadge state={skill.validation.state} />}
            />
            <div className="p-4">
              <IssueList issues={issues} />
            </div>
          </Card>
        ))
      )}
      <Callout tone="info">
        Compatibility findings are warnings: a structurally valid skill can still behave differently
        across agents. SkillScope never edits skills to fix them.
      </Callout>
      <SkillDetail skillId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
