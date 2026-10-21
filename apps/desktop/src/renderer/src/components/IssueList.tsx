import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { ValidationIssue } from '@skillscope/shared';
import { agentName } from '../lib/format';
import { Badge } from './ui';

const ICONS = {
  error: <XCircle className="size-4 text-bad" aria-label="Error" />,
  warning: <AlertTriangle className="size-4 text-warn" aria-label="Warning" />,
  info: <Info className="size-4 text-info" aria-label="Info" />,
};

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => (
        <li
          key={`${issue.code}-${i}`}
          className="flex gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <span className="mt-0.5 shrink-0">{ICONS[issue.severity]}</span>
          <div className="min-w-0">
            <p>{issue.message}</p>
            <p className="mt-0.5 text-xs text-muted">Next step: {issue.hint}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge>{issue.category}</Badge>
              {issue.agentId && <Badge tone="accent">{agentName(issue.agentId)}</Badge>}
              {issue.path && <Badge>{issue.path}</Badge>}
              <Badge>{issue.code}</Badge>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
