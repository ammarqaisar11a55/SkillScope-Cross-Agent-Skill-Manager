import type { AgentId } from '@skillscope/shared';
import { SkillScopeError } from '@skillscope/shared';
import { claudeAdapter } from './claude/adapter.js';
import { codexAdapter } from './codex/adapter.js';
import { cursorAdapter } from './cursor/adapter.js';
import type { AgentAdapter } from './types.js';

/** The built-in adapters, in display order. */
export const BUILTIN_ADAPTERS: readonly AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
];

export class AdapterRegistry {
  private readonly byId = new Map<AgentId, AgentAdapter>();

  constructor(adapters: readonly AgentAdapter[] = BUILTIN_ADAPTERS) {
    for (const adapter of adapters) this.byId.set(adapter.id, adapter);
  }

  all(): AgentAdapter[] {
    return [...this.byId.values()];
  }

  get(id: AgentId): AgentAdapter {
    const adapter = this.byId.get(id);
    if (!adapter)
      throw new SkillScopeError('UNSUPPORTED_AGENT', `No adapter registered for agent "${id}".`);
    return adapter;
  }
}
