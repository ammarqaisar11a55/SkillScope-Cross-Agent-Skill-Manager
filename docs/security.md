# Security and privacy

## Threat model

SkillScope reads folders that coding agents load instructions from, and writes third-party
content into them. The main risks are:

1. A malicious npm package writing outside its target folder or running code at install time.
2. A compromised or buggy renderer reaching the filesystem.
3. SkillScope deleting or overwriting files it does not own.
4. Leaking credentials or local skill contents.

## Electron hardening

| Control                                                                                                       | Where                                                            |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`                      | `apps/desktop/src/main/window.ts`                                |
| Strict CSP (`script-src 'self'`, no remote connections, `object-src 'none'`), sent as a header and a meta tag | `security.ts`, `renderer/index.html`                             |
| All permission requests denied (camera, notifications, ...)                                                   | `security.ts`                                                    |
| Navigation away from the app blocked; new windows denied; only `http(s)` links handed to the OS browser       | `security.ts`                                                    |
| Preload exposes one `invoke` function limited to a fixed channel list, plus two event subscriptions           | `preload/index.ts`                                               |
| Every IPC payload validated with zod in the main process; requests from other frames rejected                 | `shared/src/schemas/ipc.ts`, `main/ipc.ts`                       |
| Fuses: `RunAsNode`, `NODE_OPTIONS` and inspector flags disabled; app loaded only from `app.asar`              | `electron-builder.yml` (checked by `scripts/verify-release.mjs`) |
| Lint rule: renderer code may not import Node.js, Electron or the core engine                                  | `eslint.config.js`                                               |

The renderer never receives a path it can act on directly. "Open folder" and "read file" take a
skill **id** from the inventory; the main process resolves it, and file reads must resolve (after
following symlinks) inside that skill's folder.

The file:// protocol keeps Electron's default `GrantFileProtocolExtraPrivileges` because the
renderer loads ES modules from disk. Remote content is never loaded into the window.

## Package pipeline

See [npm-skill-packages.md](npm-skill-packages.md#what-skillscope-does-with-a-package). In short:
integrity verified before parsing, in-memory unpacking, only regular files accepted, every path
re-checked against the staging folder, and files created with exclusive flags and without
setuid or setgid bits. No lifecycle scripts, no dependency installation.

## Filesystem safety

- **Scans are read-only.** They use `stat`/`readdir`/`realpath` only and never create missing
  folders. A test asserts that modification times are unchanged.
- **Installs are confined** to installable roots that adapters resolve for the chosen agent and
  scope. Compatibility and system roots are never install targets.
- **No silent overwrite.** An existing folder is a conflict; replacing it needs explicit
  confirmation and moves the old folder to a backup first.
- **All-or-nothing.** Each step is journalled before it happens. A failure rolls every target
  back; a crash is rolled back from the journal on next start.
- **Removal deletes only owned, unchanged files** listed in the receipt (by SHA-256). Files you
  added are always kept; files you changed are kept unless you choose otherwise. Folders are
  removed only once empty.
- **Receipts are not trusted blindly.** Before removing, updating or restoring, SkillScope checks
  that the destination is still a direct child of a root the agent installs into and is not a
  symlink, so a tampered database cannot point deletion elsewhere.

## Privacy

- No telemetry, analytics or crash reporting.
- Skill contents never leave the computer. The only network traffic is to the npm registry you
  configure, and only when you use the Marketplace or check for updates. It can be turned off in
  Settings.
- Agent detection checks only whether folders such as `~/.claude` exist; it never reads agent
  configuration, conversations, tokens or API keys.
- Registry URLs with embedded credentials are rejected. Error messages and logs pass through a
  redaction filter for tokens, `Authorization` headers and URL credentials.

## Known limitations

- Custom skill locations (Settings) can be marked installable and can point anywhere your user
  can write. This is deliberate user configuration, not something a package can change.
- Installers are not code signed.
- Skill instructions and scripts are third-party content. SkillScope validates structure, not
  intent; review a skill before relying on it.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
