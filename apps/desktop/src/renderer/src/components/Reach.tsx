import type { AgentAvailability, AgentId, SkillRecord } from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { agentName } from '../lib/format';

/** Lane colour classes. These colours mean "this agent" everywhere in the app and nothing else. */
export const LANE: Record<AgentId, { text: string; bg: string; border: string }> = {
  claude: { text: 'text-lane-claude', bg: 'bg-lane-claude', border: 'border-lane-claude' },
  codex: { text: 'text-lane-codex', bg: 'bg-lane-codex', border: 'border-lane-codex' },
  cursor: { text: 'text-lane-cursor', bg: 'bg-lane-cursor', border: 'border-lane-cursor' },
};

type Reach = 'native' | 'compatible' | 'none';

export function reachOf(availability: AgentAvailability[], agent: AgentId): Reach {
  const a = availability.find((x) => x.agentId === agent);
  return a ? a.relation : 'none';
}

function describe(availability: AgentAvailability[]): string {
  const parts = AGENT_IDS.map((agent) => {
    const r = reachOf(availability, agent);
    if (r === 'none') return `${agentName(agent)}: not visible`;
    return `${agentName(agent)}: ${r === 'native' ? 'own folder' : 'compatibility folder'}`;
  });
  return parts.join('; ');
}

/** Dot for one agent: filled = the agent's own folder, ring = a folder it also reads, dash = not visible. */
export function ReachDot({
  agent,
  reach,
  size = 10,
  delay,
}: {
  agent: AgentId;
  reach: Reach;
  size?: number;
  delay?: number;
}) {
  const style = {
    width: size,
    height: size,
    ...(delay !== undefined ? { animationDelay: `${delay}ms` } : {}),
  };
  if (reach === 'none') {
    return (
      <span
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="h-px w-1/2 bg-border" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={`inline-block rounded-full ${delay !== undefined ? 'reach-dot' : ''} ${
        reach === 'native' ? LANE[agent].bg : `border-[1.5px] ${LANE[agent].border}`
      }`}
    />
  );
}

/** Compact three-lane glyph used in tables: Claude Code, Codex, Cursor from left to right. */
export function ReachGlyph({ availability }: { availability: AgentAvailability[] }) {
  return (
    <span
      role="img"
      aria-label={describe(availability)}
      title={describe(availability)}
      className="inline-flex items-center gap-1.5"
    >
      {AGENT_IDS.map((agent) => (
        <ReachDot key={agent} agent={agent} reach={reachOf(availability, agent)} />
      ))}
    </span>
  );
}

export function ReachLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {AGENT_IDS.map((agent) => (
        <span key={agent} className="inline-flex items-center gap-1.5">
          <ReachDot agent={agent} reach="native" /> {agentName(agent)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <ReachDot agent="cursor" reach="compatible" /> reads another agent's folder
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ReachDot agent="cursor" reach="none" /> not visible
      </span>
    </p>
  );
}

/**
 * The reach map: one column per skill, one row per agent. It shows at a glance which skills each
 * agent can discover and through which folder.
 */
export function ReachMap({
  skills,
  onSelect,
}: {
  skills: SkillRecord[];
  onSelect?: (id: string) => void;
}) {
  const ordered = [...skills].sort(
    (a, b) => b.availability.length - a.availability.length || a.name.localeCompare(b.name),
  );
  return (
    <div className="overflow-x-auto">
      <table
        className="border-separate border-spacing-0"
        aria-label="Which agents can discover each skill"
      >
        <tbody>
          {AGENT_IDS.map((agent, row) => (
            <tr key={agent}>
              <th
                scope="row"
                className={`pr-4 text-left text-sm font-medium whitespace-nowrap ${LANE[agent].text}`}
              >
                {agentName(agent)}
              </th>
              {ordered.map((s, col) => (
                <td key={s.id} className="px-[5px] py-[5px]">
                  <button
                    type="button"
                    onClick={() => onSelect?.(s.id)}
                    title={`${s.name}: ${reachOf(s.availability, agent) === 'none' ? 'not visible' : (s.availability.find((a) => a.agentId === agent)?.reason ?? '')}`}
                    className="flex size-5 items-center justify-center rounded-full hover:bg-surface-3"
                    aria-label={`${s.name}, ${agentName(agent)}: ${reachOf(s.availability, agent)}`}
                  >
                    <ReachDot
                      agent={agent}
                      reach={reachOf(s.availability, agent)}
                      size={11}
                      delay={(col + row * 3) * 18}
                    />
                  </button>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td />
            {ordered.map((s) => (
              <td key={s.id} className="h-28 px-[5px] align-top">
                <span
                  className={`block origin-top-left translate-x-2.5 rotate-[55deg] text-xs whitespace-nowrap ${s.validation.state === 'invalid' ? 'text-bad' : 'text-muted'}`}
                >
                  {s.name}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
