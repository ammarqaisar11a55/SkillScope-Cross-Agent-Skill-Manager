import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, ArrowUpCircle, RefreshCw, Trash2 } from 'lucide-react';
import type {
  OperationRecord,
  ReceiptState,
  RemovalPreview,
  UpdateCheck,
  UpdatePreview,
} from '@skillscope/shared';
import { call, errorText } from '../lib/api';
import { agentName, formatDate, relativeTime } from '../lib/format';
import { useApp } from '../state/app-state';
import { OperationProgressBar } from '../components/OperationProgressBar';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorCallout,
  Modal,
  Mono,
  Spinner,
} from '../components/ui';

const STATE_TONE = {
  succeeded: 'ok',
  failed: 'bad',
  'rolled-back': 'warn',
  running: 'info',
  cancelled: 'neutral',
} as const;
const CHANGE_TONE = {
  added: 'ok',
  removed: 'bad',
  modified: 'warn',
  unchanged: 'neutral',
} as const;

type Dialog =
  | { kind: 'update'; preview: UpdatePreview }
  | { kind: 'remove'; receiptId: string; preview: RemovalPreview }
  | { kind: 'restore'; receiptId: string; skill: string; backup: string };

export function Installations() {
  const { rescan, settings } = useApp();
  const [receipts, setReceipts] = useState<ReceiptState[] | null>(null);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [updates, setUpdates] = useState<Map<string, UpdateCheck>>(new Map());
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [option, setOption] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([
        call('receipts:list'),
        call('operations:list', { limit: 100 }),
      ]);
      setReceipts(r);
      setOperations(o);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const checkUpdates = async () => {
    setChecking(true);
    setError(null);
    try {
      setUpdates(new Map((await call('updates:check')).map((u) => [u.receiptId, u])));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  const finish = async () => {
    setDialog(null);
    setOption(false);
    await load();
    await rescan();
  };

  const confirmDialog = async () => {
    if (!dialog) return;
    const id = dialog.kind === 'update' ? dialog.preview.receiptId : dialog.receiptId;
    await run(id, async () => {
      if (dialog.kind === 'update') {
        await call('updates:apply', {
          receiptId: id,
          stagingId: dialog.preview.stagingId,
          confirmed: true,
          overwriteModified: option,
        });
      } else if (dialog.kind === 'remove') {
        await call('removal:execute', { receiptId: id, removeModified: option, confirmed: true });
      } else {
        await call('backups:restore', { receiptId: id, confirmed: true });
      }
      await finish();
    });
  };

  if (!receipts)
    return error ? <ErrorCallout error={error} /> : <Spinner label="Loading installations…" />;

  return (
    <div className="space-y-5">
      <ErrorCallout error={dialog ? null : error} />
      <Card>
        <CardHeader
          title="Skills installed through SkillScope"
          subtitle="Each agent target has its own record, checksums and backup."
          actions={
            <Button
              icon={<RefreshCw className="size-4" />}
              busy={checking}
              disabled={!settings?.privacy.allowNetwork || receipts.length === 0}
              onClick={() => void checkUpdates()}
            >
              Check for updates
            </Button>
          }
        />
        {receipts.length === 0 ? (
          <EmptyState title="Nothing installed through SkillScope yet">
            Install skills from the Marketplace. Skills you installed by other means appear in the
            Skills inventory as “Installed externally”.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {receipts.map(({ receipt: r, present, modifiedFiles, missingFiles, extraFiles }) => {
              const update = updates.get(r.id);
              return (
                <li key={r.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.skillName}</span>
                    <span className="text-muted">
                      {r.packageName}@{r.version}
                    </span>
                    {r.agentIds.map((a) => (
                      <Badge key={a} tone="accent">
                        {agentName(a)}
                      </Badge>
                    ))}
                    <Badge>{r.scope}</Badge>
                    {!present ? (
                      <Badge tone="bad">Missing from disk</Badge>
                    ) : modifiedFiles.length + extraFiles.length > 0 ? (
                      <Badge tone="warn">Changes detected</Badge>
                    ) : (
                      <Badge tone="ok">Unchanged</Badge>
                    )}
                    {update?.updateAvailable && <Badge tone="info">Update: {update.latest}</Badge>}
                    {update?.error && (
                      <Badge tone="bad" title={update.error}>
                        Update check failed
                      </Badge>
                    )}
                    <span className="ml-auto flex gap-1">
                      {update?.updateAvailable && (
                        <Button
                          className="h-7"
                          icon={<ArrowUpCircle className="size-4" />}
                          busy={busyId === r.id}
                          onClick={() =>
                            void run(r.id, async () =>
                              setDialog({
                                kind: 'update',
                                preview: await call('updates:preview', {
                                  receiptId: r.id,
                                  ...(update.latest ? { version: update.latest } : {}),
                                }),
                              }),
                            )
                          }
                        >
                          Update
                        </Button>
                      )}
                      {r.backupPath && (
                        <Button
                          className="h-7"
                          icon={<ArchiveRestore className="size-4" />}
                          onClick={() =>
                            setDialog({
                              kind: 'restore',
                              receiptId: r.id,
                              skill: r.skillName,
                              backup: r.backupPath ?? '',
                            })
                          }
                        >
                          Restore backup
                        </Button>
                      )}
                      <Button
                        className="h-7"
                        variant="ghost"
                        icon={<Trash2 className="size-4" />}
                        busy={busyId === r.id && dialog === null}
                        onClick={() =>
                          void run(r.id, async () =>
                            setDialog({
                              kind: 'remove',
                              receiptId: r.id,
                              preview: await call('removal:preview', { receiptId: r.id }),
                            }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    </span>
                  </div>
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">Installed to</dt>
                    <dd>
                      <Mono>{r.destination}</Mono>
                    </dd>
                    <dt className="text-muted">Installed</dt>
                    <dd>
                      {formatDate(r.installedAt)} · integrity{' '}
                      <Mono>{r.integrity ? `${r.integrity.slice(0, 24)}…` : 'none'}</Mono>
                    </dd>
                    <dt className="text-muted">Content hash</dt>
                    <dd>
                      <Mono>{r.contentHash}</Mono>
                    </dd>
                    <dt className="text-muted">Backup</dt>
                    <dd>
                      {r.backupPath ? <Mono>{r.backupPath}</Mono> : 'none (nothing was replaced)'}
                    </dd>
                    {(modifiedFiles.length > 0 ||
                      missingFiles.length > 0 ||
                      extraFiles.length > 0) && (
                      <>
                        <dt className="text-muted">Local changes</dt>
                        <dd>
                          {[
                            ...modifiedFiles.map((f) => `modified ${f}`),
                            ...missingFiles.map((f) => `missing ${f}`),
                            ...extraFiles.map((f) => `added ${f}`),
                          ].join(', ')}
                        </dd>
                      </>
                    )}
                  </dl>
                  <details>
                    <summary className="cursor-pointer text-xs text-accent">
                      {r.files.length} managed file(s) with checksums
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {r.files.map((f) => (
                        <li key={f.path}>
                          <Mono>{f.path}</Mono>{' '}
                          <Mono className="text-muted">sha256 {f.sha256.slice(0, 16)}…</Mono>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Operation history"
          subtitle="Installs, updates, removals and scans, including rollbacks and rejected packages."
        />
        {operations.length === 0 ? (
          <EmptyState title="No operations yet" />
        ) : (
          <ul className="divide-y divide-border">
            {operations.map((op) => (
              <li key={op.id} className="px-4 py-2.5 text-sm">
                <details>
                  <summary className="flex cursor-pointer items-center gap-2">
                    <Badge tone={STATE_TONE[op.state]}>{op.state}</Badge>
                    <span className="flex-1 truncate">{op.summary}</span>
                    <span className="text-xs text-muted">{relativeTime(op.startedAt)}</span>
                  </summary>
                  <div className="mt-2 space-y-1 pl-2 text-xs text-muted">
                    {op.error && <p className="text-bad">{op.error}</p>}
                    {op.details.map((d, i) => (
                      <p key={i}>{d}</p>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={dialog !== null}
        wide={dialog?.kind === 'update'}
        title={
          dialog?.kind === 'update'
            ? `Update ${dialog.preview.skillName}`
            : dialog?.kind === 'remove'
              ? 'Remove skill'
              : 'Restore backup'
        }
        onClose={() => {
          setDialog(null);
          setOption(false);
        }}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant={dialog?.kind === 'remove' ? 'danger' : 'primary'}
              busy={busyId !== null}
              disabled={
                dialog?.kind === 'update' &&
                (!dialog.preview.skillPresentInNewVersion ||
                  (dialog.preview.localModifications.length > 0 && !option))
              }
              onClick={() => void confirmDialog()}
            >
              {dialog?.kind === 'update'
                ? 'Update'
                : dialog?.kind === 'remove'
                  ? 'Remove'
                  : 'Restore'}
            </Button>
          </>
        }
      >
        {dialog?.kind === 'update' && (
          <div className="space-y-3 text-sm">
            <p>
              {dialog.preview.packageName}: <strong>{dialog.preview.from}</strong> →{' '}
              <strong>{dialog.preview.to}</strong>
            </p>
            {!dialog.preview.skillPresentInNewVersion && (
              <Callout
                tone="bad"
                title="The new version does not contain a valid copy of this skill."
              />
            )}
            <ul className="space-y-0.5">
              {dialog.preview.diff.map((d) => (
                <li key={d.path}>
                  <Badge tone={CHANGE_TONE[d.change]}>{d.change}</Badge> <Mono>{d.path}</Mono>
                </li>
              ))}
            </ul>
            {dialog.preview.localModifications.length > 0 && (
              <>
                <Callout tone="warn" title="You changed this skill after installing it">
                  {dialog.preview.localModifications.join(', ')}
                </Callout>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={option}
                    onChange={(e) => setOption(e.target.checked)}
                  />{' '}
                  Replace my changes (a backup is kept)
                </label>
              </>
            )}
            <OperationProgressBar kinds={['install', 'update']} />
          </div>
        )}
        {dialog?.kind === 'remove' && (
          <div className="space-y-3 text-sm">
            <p>
              <Mono>{dialog.preview.destination}</Mono>
            </p>
            <p>
              {dialog.preview.filesToRemove.length} unchanged file(s) installed by SkillScope will
              be deleted.
            </p>
            {dialog.preview.unownedFiles.length > 0 && (
              <Callout tone="info" title="Files you added are kept">
                {dialog.preview.unownedFiles.join(', ')}
              </Callout>
            )}
            {dialog.preview.modifiedFiles.length > 0 && (
              <>
                <Callout tone="warn" title="Files you modified">
                  {dialog.preview.modifiedFiles.join(', ')}
                </Callout>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={option}
                    onChange={(e) => setOption(e.target.checked)}
                  />{' '}
                  Also delete my modified files
                </label>
              </>
            )}
          </div>
        )}
        {dialog?.kind === 'restore' && (
          <div className="space-y-2 text-sm">
            <p>Put back the content that was replaced when {dialog.skill} was installed:</p>
            <Mono>{dialog.backup}</Mono>
            <p className="text-muted">The current content is moved to a new backup first.</p>
          </div>
        )}
        <ErrorCallout error={error} />
      </Modal>
    </div>
  );
}
