import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50',
  secondary: 'border border-border bg-surface-2 hover:bg-surface-3 disabled:opacity-50',
  ghost: 'hover:bg-surface-3 disabled:opacity-50',
  danger: 'bg-bad text-white hover:opacity-90 disabled:opacity-50',
};

export function Button({
  variant = 'secondary',
  busy = false,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  busy?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-surface-2 ${className}`}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  actions,
  subtitle,
}: {
  title: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/12 text-warn',
  bad: 'bg-bad/12 text-bad',
  info: 'bg-info/12 text-info',
  accent: 'bg-accent/12 text-accent',
};

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const CALLOUT = {
  info: { icon: Info, cls: 'border-info/30 bg-info/8 text-fg', iconCls: 'text-info' },
  ok: { icon: CheckCircle2, cls: 'border-ok/30 bg-ok/8 text-fg', iconCls: 'text-ok' },
  warn: { icon: AlertTriangle, cls: 'border-warn/30 bg-warn/8 text-fg', iconCls: 'text-warn' },
  bad: { icon: XCircle, cls: 'border-bad/30 bg-bad/8 text-fg', iconCls: 'text-bad' },
} as const;

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const { icon: Icon, cls, iconCls } = CALLOUT[tone];
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'note'}
      className={`flex gap-2.5 rounded-md border px-3 py-2.5 text-sm ${cls}`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconCls}`} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-0.5 text-muted' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorCallout({ error }: { error: { message: string; hint?: string } | null }) {
  if (!error) return null;
  return (
    <Callout tone="bad" title={error.message}>
      {error.hint}
    </Callout>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`m-auto max-h-[85vh] w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} overflow-hidden rounded-lg border border-border bg-surface-2 p-0 text-fg shadow-2xl backdrop:bg-black/50`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id={titleId} className="font-semibold">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded p-1 hover:bg-surface-3"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm placeholder:text-muted focus:border-accent focus:outline-none';

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        className="size-4 accent-[var(--accent)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <code className={`break-all font-mono text-xs ${className}`}>{children}</code>;
}
