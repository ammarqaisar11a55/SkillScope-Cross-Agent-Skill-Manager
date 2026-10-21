import { randomUUID } from 'node:crypto';
import type {
  OperationKind,
  OperationProgress,
  OperationRecord,
  OperationState,
} from '@skillscope/shared';
import { redactSecrets } from '@skillscope/shared';
import type { SkillScopeStore } from '../persistence/store.js';

export type ProgressListener = (progress: OperationProgress) => void;

/** One running operation. Every detail line is redacted before it is stored or emitted. */
export class Operation {
  readonly record: OperationRecord;

  constructor(
    private readonly log: OperationLog,
    kind: OperationKind,
    summary: string,
    meta: { packageName?: string; version?: string } = {},
  ) {
    this.record = {
      id: `op_${randomUUID().replace(/-/g, '')}`,
      kind,
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      summary: redactSecrets(summary),
      packageName: meta.packageName ?? null,
      version: meta.version ?? null,
      details: [],
      error: null,
    };
  }

  note(line: string): void {
    this.record.details.push(redactSecrets(line));
  }

  progress(step: string, completed: number, total: number): void {
    this.note(step);
    this.log.emit({
      operationId: this.record.id,
      kind: this.record.kind,
      step: redactSecrets(step),
      completed,
      total,
    });
  }

  async finish(
    state: Exclude<OperationState, 'running'>,
    error?: string,
  ): Promise<OperationRecord> {
    this.record.state = state;
    this.record.finishedAt = new Date().toISOString();
    if (error) this.record.error = redactSecrets(error);
    await this.log.persist(this.record);
    return this.record;
  }
}

export class OperationLog {
  private readonly listeners = new Set<ProgressListener>();

  constructor(private readonly store: SkillScopeStore | null) {}

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(progress: OperationProgress): void {
    for (const l of this.listeners) l(progress);
  }

  async start(
    kind: OperationKind,
    summary: string,
    meta: { packageName?: string; version?: string } = {},
  ): Promise<Operation> {
    const op = new Operation(this, kind, summary, meta);
    await this.persist(op.record);
    return op;
  }

  async persist(record: OperationRecord): Promise<void> {
    if (this.store) await this.store.saveOperation({ ...record, details: [...record.details] });
  }
}
