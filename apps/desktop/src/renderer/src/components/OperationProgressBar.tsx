import { useApp } from '../state/app-state';

/** Live progress for long operations, fed by the main process over IPC. */
export function OperationProgressBar({ kinds }: { kinds: string[] }) {
  const { progress } = useApp();
  if (!progress || !kinds.includes(progress.kind)) return null;
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={progress.step}
      className="space-y-1"
    >
      <div className="flex justify-between text-xs text-muted">
        <span>{progress.step}</span>
        <span>
          {progress.completed}/{progress.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-surface-3">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
