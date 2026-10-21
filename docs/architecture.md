# Architecture

Decision record: [adr/0001-architecture-and-tooling.md](adr/0001-architecture-and-tooling.md).

```text
┌────────────────────────── apps/desktop ──────────────────────────┐
│ renderer (React, sandboxed)   preload (contextBridge)   main      │
│   pages, components  ──invoke(channel, payload)──▶  ipc.ts        │
│                       ◀──Result<T> / progress ────   handlers.ts  │
└───────────────────────────────────────────────────────┬──────────┘
                                                        │ validated calls
┌──────────────────────────── packages/core ────────────▼──────────┐
│ service/      SkillScopeService (inventory, settings)             │
│               SkillScopeApp     (+ npm, install, update, remove)  │
│ agents/       AgentAdapter contract; claude, codex, cursor        │
│ platform/     PlatformContext (path.win32 / path.posix, home, env)│
│ discovery/    read-only scanner, cross-agent discovery            │
│ validation/   SKILL.md frontmatter parser, validator              │
│ inventory/    tree hashing, normalisation, duplicates, query      │
│ packages/     registry client, integrity, tarball, staging,       │
│               layout inspection, acquisition pipeline             │
│ installation/ planner (targets, conflicts), installer (journal)   │
│ removal/      owned-file removal, update checks                   │
│ export/       JSON / CSV / Markdown                               │
│ persistence/  sql.js store (settings, snapshots, receipts, log)   │
│ logging/      redacting operation log + progress events           │
└───────────────────────────────────────────────────────────────────┘
┌──────────────────────────── packages/shared ─────────────────────┐
│ domain types · zod schemas (IPC, settings, agent-skill.json) ·    │
│ error model (SkillScopeError, Result, errno hints, redaction)     │
└───────────────────────────────────────────────────────────────────┘
```

## Data flow

**Scan.** `discoverSkills` asks each adapter for its roots, scans each physical folder once (to
the deepest depth any agent needs), and records a _sighting_ per (root, skill folder).
`buildInventory` groups sightings by canonical path into one `SkillRecord` per folder with an
`availability` entry per agent, hashes the tree, validates it and finds duplicates. The snapshot
is saved so the last inventory can be viewed offline. The filesystem stays the source of truth;
receipts in the database only mark which folders SkillScope manages.

**Install.** `acquirePackage` → `planInstall` → user confirmation → `executePlan` → receipts →
rescan. Plans live in memory for 30 minutes and are re-checked for staleness before execution.

**Unique skills vs availability.** `stats.uniqueSkills` counts folders; `stats.availabilityRecords`
counts (skill, agent) pairs. `~/.agents/skills/x`, read by Codex and Cursor, counts 1 and 2.

## Adding an agent

1. Add the id to `AGENT_IDS` and `AGENT_DISPLAY_NAMES` in `packages/shared/src/types/agents.ts`.
2. Implement `AgentAdapter` in `packages/core/src/agents/<agent>/adapter.ts`: roots (with
   relation, scope, depth, installability), evidence paths, install roots, compatibility checks,
   diagnostics and the date the paths were verified.
3. Register it in `BUILTIN_ADAPTERS` and add a lane colour in `styles.css` and `Reach.tsx`.

Discovery, inventory, validation, installation and the UI need no other change.

## Persistence

`sql.js` (SQLite compiled to WebAssembly, inline build, so no native module or `.wasm` file
to ship). Tables: `settings`, `snapshots` (last inventory), `scans`, `receipts`, `operations`.
The database is flushed to disk atomically after each write and migrated by `PRAGMA user_version`.

## Testing

| Layer         | Tool                         | Notes                                                                                    |
| ------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| shared, core  | Vitest                       | Synthetic fixtures in `fixtures/`, temporary directories, mock registry. No network.     |
| desktop main  | Vitest                       | IPC dispatcher and handlers with a mocked Electron.                                      |
| desktop app   | Playwright `_electron`       | Built app against fixture homes, including a full install through a local mock registry. |
| packaged app  | `scripts/verify-release.mjs` | asar contents, fuses, self-check of the real executable.                                 |
| live registry | Vitest, opt-in               | `npm run test:integration` (separate `integration` project).                             |
