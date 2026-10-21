import type { AgentId, SkillScopeKind, ValidationState } from '@skillscope/shared';
import { AGENT_DISPLAY_NAMES } from '@skillscope/shared';

export function agentName(id: AgentId): string {
  return AGENT_DISPLAY_NAMES[id];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export const SCOPE_LABELS: Record<SkillScopeKind, string> = {
  global: 'Global',
  project: 'Project',
  system: 'System',
};

export const VALIDATION_LABELS: Record<ValidationState, string> = {
  valid: 'Valid',
  warnings: 'Warnings',
  invalid: 'Invalid',
};

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
