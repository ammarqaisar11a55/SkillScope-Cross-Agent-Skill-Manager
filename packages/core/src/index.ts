export * from './platform/context.js';
export * from './agents/types.js';
export * from './agents/common.js';
export * from './agents/registry.js';
export { claudeAdapter, CLAUDE_DESCRIPTOR } from './agents/claude/adapter.js';
export { codexAdapter, CODEX_DESCRIPTOR } from './agents/codex/adapter.js';
export { cursorAdapter, CURSOR_DESCRIPTOR } from './agents/cursor/adapter.js';
export * from './discovery/scanner.js';
export * from './discovery/discover.js';
