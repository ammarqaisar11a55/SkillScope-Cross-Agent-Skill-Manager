# Development

## Requirements

- Node.js 22.12 or newer (npm 10+)
- Linux or Windows (macOS works for development but is not a release target)
- Python 3 with Pillow, only to regenerate the app icon

## Setup

```bash
npm ci --ignore-scripts
node node_modules/electron/install.js
```

`--ignore-scripts` keeps third-party install scripts from running; the Electron binary is then
downloaded explicitly.

## Everyday commands

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                     | Electron with hot-reloading renderer                                 |
| `npm test`                        | Unit and engine tests (shared, core, desktop main)                   |
| `npm run test:e2e`                | Builds must exist (`npm run build`); runs Playwright against the app |
| `npm run typecheck`               | `tsc` for every package                                              |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                    |
| `npm run check`                   | typecheck + lint + format check + tests                              |
| `npm run build`                   | Library builds and the bundled desktop app in `apps/desktop/out`     |
| `npm run package`                 | Installers for the current OS in `apps/desktop/release/<version>`    |
| `npm run verify:release`          | Release checks and packaged self-check                               |
| `npm run test:integration`        | Opt-in tests against the real npm registry                           |
| `npm run icon`                    | Regenerate `apps/desktop/build/icon.{png,ico}`                       |

On Linux without a display, prefix Playwright and `verify:release` with
`xvfb-run --auto-servernum`.

## Test isolation

The desktop app honours these environment variables, meant for tests:

| Variable                       | Effect                                                |
| ------------------------------ | ----------------------------------------------------- |
| `SKILLSCOPE_HOME_OVERRIDE`     | Use this folder as the home directory for agent paths |
| `SKILLSCOPE_DATA_DIR`          | Use this folder for the database, staging and backups |
| `SKILLSCOPE_OFFLINE=1`         | Refuse all registry requests                          |
| `SKILLSCOPE_SMOKE_TEST=<file>` | Run the self-check, write a JSON report and exit      |

Tests always copy fixtures to temporary folders, so a real `~/.claude`, `~/.agents` or `~/.cursor`
is never read or modified.

## Regenerating documentation assets

```bash
SKILLSCOPE_SCREENSHOTS=1 npm run test:e2e -- screenshots         # docs/screenshots
SKILLSCOPE_WRITE_EXAMPLES=1 npx vitest run --project core tests/examples.test.ts   # docs/examples
```

## Repository layout

```text
apps/desktop      Electron app (main, preload, renderer) and packaging config
packages/core     Skill-management engine
packages/shared   Types, schemas and errors shared by every package
fixtures          Synthetic homes, workspaces, skills and npm packages for tests
docs              Architecture, paths, package format, security, release docs
scripts           Icon generation and release verification
```
