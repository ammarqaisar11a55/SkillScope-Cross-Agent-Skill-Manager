import { useEffect, useState } from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import type { SkillDetails } from '@skillscope/shared';
import { call, errorText } from '../lib/api';
import { agentName, formatBytes, formatDate } from '../lib/format';
import { AgentChips, ScopeBadge, StatusChips, ValidationBadge } from './skill-badges';
import { Button, Callout, ErrorCallout, Modal, Mono, Spinner } from './ui';
import { IssueList } from './IssueList';

export function SkillDetail({ skillId, onClose }: { skillId: string | null; onClose: () => void }) {
  const [details, setDetails] = useState<SkillDetails | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [preview, setPreview] = useState<{
    path: string;
    content: string;
    truncated: boolean;
  } | null>(null);

  useEffect(() => {
    setDetails(null);
    setPreview(null);
    setError(null);
    if (!skillId) return;
    void call('inventory:skill-details', { skillId }).then(setDetails, (e: unknown) =>
      setError(errorText(e)),
    );
  }, [skillId]);

  const openFile = async (path: string) => {
    if (!skillId) return;
    try {
      setPreview(await call('inventory:read-file', { skillId, path }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const skill = details?.skill;
  return (
    <Modal
      open={skillId !== null}
      onClose={onClose}
      wide
      title={skill ? skill.name : 'Skill details'}
    >
      {!details && !error && <Spinner label="Loading…" />}
      <ErrorCallout error={error} />
      {skill && details && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <ValidationBadge state={skill.validation.state} />
            <ScopeBadge scope={skill.scope} />
            <StatusChips skill={skill} all />
          </div>
          {skill.description && <p className="text-sm">{skill.description}</p>}

          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Path</dt>
            <dd className="flex items-start gap-2">
              <Mono>{skill.path}</Mono>
              <Button
                variant="ghost"
                className="h-6 px-1.5"
                icon={<FolderOpen className="size-3.5" />}
                onClick={() => void call('inventory:reveal', { skillId: skill.id })}
              >
                Open
              </Button>
            </dd>
            {skill.isSymlink && (
              <>
                <dt className="text-muted">Real path</dt>
                <dd>
                  <Mono>{skill.realPath}</Mono>
                </dd>
              </>
            )}
            <dt className="text-muted">Files</dt>
            <dd>
              {skill.fileCount} ({formatBytes(skill.totalBytes)})
            </dd>
            <dt className="text-muted">Last changed</dt>
            <dd>{formatDate(skill.modifiedAt)}</dd>
            <dt className="text-muted">Content hash</dt>
            <dd>
              <Mono>{skill.contentHash}</Mono>
            </dd>
            <dt className="text-muted">Package</dt>
            <dd>
              {skill.package
                ? `${skill.package.name}@${skill.package.version} (installed by SkillScope)`
                : 'Installed externally'}
            </dd>
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Why agents can see it</h3>
            <AgentChips availability={skill.availability} />
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {skill.availability.map((a) => (
                <li key={a.agentId}>
                  <span className="font-medium text-fg">{agentName(a.agentId)}:</span> {a.reason}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Detected on disk only — this does not prove the agent has loaded the skill.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Validation</h3>
            {skill.validation.issues.length === 0 ? (
              <Callout tone="ok" title="No issues found" />
            ) : (
              <IssueList issues={skill.validation.issues} />
            )}
          </section>

          {details.duplicates.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Duplicates</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1">Name</th>
                    <th>Path</th>
                    <th>Same content</th>
                  </tr>
                </thead>
                <tbody>
                  {details.duplicates.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-1.5">{d.name}</td>
                      <td>
                        <Mono>{d.path}</Mono>
                      </td>
                      <td>{d.contentHash === skill.contentHash ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="grid gap-4 md:grid-cols-[14rem_1fr]">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Files</h3>
              <ul className="max-h-72 space-y-0.5 overflow-auto text-sm">
                {details.files.map((f) => (
                  <li key={f.path}>
                    {f.kind === 'file' ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-surface-3"
                        onClick={() => void openFile(f.path)}
                      >
                        <FileText className="size-3.5 shrink-0 text-muted" />
                        <span className="truncate">{f.path}</span>
                      </button>
                    ) : (
                      <span className="block px-1 py-0.5 text-muted">
                        {f.path}
                        {f.kind === 'directory' ? '/' : ` (${f.kind})`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold">{preview ? preview.path : 'SKILL.md'}</h3>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">
                {preview ? preview.content : (details.skillMd ?? 'No SKILL.md')}
              </pre>
              {preview?.truncated && <p className="mt-1 text-xs text-muted">Preview truncated.</p>}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
