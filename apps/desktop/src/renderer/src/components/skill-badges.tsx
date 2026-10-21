import type {
  AgentAvailability,
  SkillRecord,
  SkillStatus,
  ValidationState,
} from '@skillscope/shared';
import { SKILL_STATUS_LABELS } from '@skillscope/shared';
import { agentName, SCOPE_LABELS, VALIDATION_LABELS } from '../lib/format';
import { Badge, type Tone } from './ui';

const VALIDATION_TONES: Record<ValidationState, Tone> = {
  valid: 'ok',
  warnings: 'warn',
  invalid: 'bad',
};

export function ValidationBadge({ state }: { state: ValidationState }) {
  return <Badge tone={VALIDATION_TONES[state]}>{VALIDATION_LABELS[state]}</Badge>;
}

export function AgentChips({ availability }: { availability: AgentAvailability[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {availability.map((a) => (
        <Badge
          key={a.agentId}
          tone={a.relation === 'native' ? 'accent' : 'neutral'}
          title={a.reason}
        >
          {agentName(a.agentId)}
          {a.relation === 'compatible' && <span className="opacity-70">(compat)</span>}
        </Badge>
      ))}
    </div>
  );
}

const STATUS_TONES: Partial<Record<SkillStatus, Tone>> = {
  'invalid-metadata': 'bad',
  'missing-required-file': 'bad',
  'shared-location': 'info',
  'duplicate-content': 'warn',
  'duplicate-name': 'warn',
  'installed-skillscope': 'accent',
  'changes-detected': 'warn',
};

/** Status chips worth showing in tables; "detected" and "runtime unverified" apply to all rows. */
export function StatusChips({ skill, all = false }: { skill: SkillRecord; all?: boolean }) {
  const hidden: SkillStatus[] = all
    ? []
    : ['detected', 'valid', 'installed-external', 'runtime-unverified'];
  return (
    <div className="flex flex-wrap gap-1">
      {skill.statuses
        .filter((s) => !hidden.includes(s))
        .map((s) => (
          <Badge key={s} tone={STATUS_TONES[s] ?? 'neutral'}>
            {SKILL_STATUS_LABELS[s]}
          </Badge>
        ))}
    </div>
  );
}

export function ScopeBadge({ scope }: { scope: SkillRecord['scope'] }) {
  return <Badge tone={scope === 'project' ? 'info' : 'neutral'}>{SCOPE_LABELS[scope]}</Badge>;
}
