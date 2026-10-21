# ADR 0001 — Architecture and tooling

- Status: accepted
- Date: 2026-10-21

## Context

SkillScope is a desktop application that discovers, validates and installs agent skills for
Claude Code, OpenAI Codex and Cursor on Linux and Windows. It touches the user's filesystem and
downloads third-party content from npm, so the design has to keep privileged code small,
testable and isolated from the UI.

## Decision

1. **Monorepo with npm workspaces** (`packages/shared`, `packages/core`, `apps/desktop`).
   The plan suggested pnpm; npm workspaces ship with Node.js, need no extra global tool on
   contributor machines or CI, and give us a committed `package-lock.json`. Nothing in the
   design depends on pnpm-specific features.
2. **`@skillscope/shared`** holds the single domain model: TypeScript types, zod schemas
   (IPC payloads, settings, the `agent-skill.json` package contract) and the typed error/result
   model. It has no Node.js dependencies so the renderer can import it.
3. **`@skillscope/core`** is the skill-management engine. Every responsibility is its own
   module: platform paths, agent adapters, discovery, validation, inventory, registry client,
   integrity, tar parsing, staging, installation, removal/update, export, persistence and
   operation logging. A thin `SkillScopeService` is the application service layer: it validates
   requests, resolves targets through adapters and returns `Result` values.
4. **`@skillscope/desktop`** is Electron + React + Vite (via `electron-vite`) + Tailwind CSS +
   Lucide icons. The main process hosts the service; the preload script exposes a narrow,
   typed `window.skillscope` API through `contextBridge`; the renderer has no Node.js access
   (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP).
5. **Packaging with electron-builder**, because it produces AppImage, `.deb` and an NSIS
   `.exe` installer from one configuration, all of which are required targets. Electron Forge
   has no maintained AppImage maker.
6. **Persistence with sql.js** (SQLite compiled to WebAssembly). It needs no native module
   rebuild for each Electron ABI and platform, which keeps Linux and Windows packaging simple.
   The database file is written atomically (temp file + rename). The database only stores
   application-owned records; the filesystem is always the source of truth for discovery.
7. **Package pipeline without npm**. The registry client talks to the public registry HTTP API
   with `fetch`, verifies `dist.integrity` (SRI sha512) with `node:crypto`, and parses tarballs
   with `tar-stream` + `node:zlib`. Lifecycle scripts are never executed and dependencies are
   never installed. End users therefore do not need Node.js or npm.
8. **Platform abstraction**: all path logic takes a `PlatformContext`
   (`platform`, `homeDir`, `env`, `path` = `path.win32` or `path.posix`). This lets the Linux CI
   job verify Windows path resolution deterministically, while the Windows CI job verifies real
   filesystem behaviour.

## Consequences

- Workspace packages are consumed from TypeScript source inside the monorepo; the desktop build
  bundles them, and `tsc` emits declarations for each package in CI.
- sql.js holds the database in memory and flushes on each write; the data volume (scan history,
  receipts) is small enough for this to be cheap.
- Adding an agent means adding one adapter that implements `AgentAdapter`; the inventory,
  validation and installation engines do not change.
