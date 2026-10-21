# Supported agent paths

Paths were checked against each vendor's official documentation on **2026-10-21**. They are
encoded in the adapters under `packages/core/src/agents/<agent>/adapter.ts` together with that
date (`pathsVerifiedOn`), so a future review knows what to re-check.

Notation: `~` is the user's home directory (`os.homedir()`: `/home/<user>` on Linux,
`C:\Users\<user>` on Windows). `<project>` is the workspace selected in Settings. Paths are
joined with the platform's separator at runtime; nothing is hard-coded with `/`.

## Claude Code

Source: <https://code.claude.com/docs/en/skills>

| Scope   | Path                                                   | Installable   | Notes                                             |
| ------- | ------------------------------------------------------ | ------------- | ------------------------------------------------- |
| global  | `~/.claude/skills/<skill>/SKILL.md`                    | yes (default) | `CLAUDE_CONFIG_DIR` relocates `~/.claude`.        |
| global  | `~/.claude/skills/synced/<skill>/SKILL.md`             | no            | Synced from claude.ai and managed by Claude Code. |
| project | `<project>/.claude/skills/<skill>/SKILL.md`            | yes (default) |                                                   |
| system  | `/etc/claude-code/.claude/skills` (Linux)              | no            | Enterprise skills deployed by an organisation.    |
| system  | `C:\Program Files\ClaudeCode\.claude\skills` (Windows) | no            | **Inferred, not confirmed** by the documentation. |

Not scanned: nested `<subdir>/.claude/skills` folders, `--add-dir` directories, plugin skills
(`<plugin>/skills`, managed by the plugin system) and legacy `.claude/commands`.

Frontmatter: every field is optional; `name` defaults to the directory name; `description` is
recommended. Names must not contain `<`, `>`, control or invisible characters. The
`anthropic-skills` namespace and a folder named `synced` are reserved.

## OpenAI Codex

Source: <https://learn.chatgpt.com/docs/build-skills> (redirect target of
`developers.openai.com/codex/skills`).

| Scope   | Path                                        | Installable   | Notes                                           |
| ------- | ------------------------------------------- | ------------- | ----------------------------------------------- |
| global  | `~/.agents/skills/<skill>/SKILL.md`         | yes (default) | Shared with Cursor.                             |
| project | `<project>/.agents/skills/<skill>/SKILL.md` | yes (default) | Shared with Cursor.                             |
| system  | `/etc/codex/skills`                         | no            | Documented admin location; not used on Windows. |

Codex also reads `.agents/skills` in every parent directory between the working directory and the
repository root. SkillScope scans only the selected workspace root and does not walk parents.
Bundled system skills have no filesystem location and are not listed. `~/.codex/skills` is not a
documented Codex location in the current docs, so it is not attributed to Codex.

Frontmatter: `name` and `description` are required. `agents/openai.yaml` holds optional
Codex-specific metadata.

## Cursor

Source: <https://cursor.com/docs/context/skills>

| Scope   | Path                       | Relation                   | Installable   |
| ------- | -------------------------- | -------------------------- | ------------- |
| global  | `~/.cursor/skills`         | native                     | yes (default) |
| global  | `~/.agents/skills`         | native (shared with Codex) | yes           |
| global  | `~/.claude/skills`         | compatible                 | no            |
| global  | `~/.codex/skills`          | compatible                 | no            |
| project | `<project>/.cursor/skills` | native                     | yes (default) |
| project | `<project>/.agents/skills` | native (shared with Codex) | yes           |
| project | `<project>/.claude/skills` | compatible                 | no            |
| project | `<project>/.codex/skills`  | compatible                 | no            |

Cursor walks roots recursively, so category folders (`<root>/<category>/<skill>/SKILL.md`) are
supported up to the depth set in Settings (default 4). Nested project folders such as
`apps/web/.cursor/skills` are not scanned.

Frontmatter: `name` (lowercase letters, digits, hyphens; must match the folder) and
`description` are required; `paths`, `disable-model-invocation`, `icon`, `color` and `metadata`
are optional; the legacy `globs` field is still accepted.

## Ownership rules

- A skill found in a **compatible** root is reported as _available to_ that agent, with the
  reason, but not as installed for it.
- A physical directory read by several agents appears once in the inventory with several
  availability records and the _Shared location_ status.
- Discovery is read-only: SkillScope never creates a missing root during a scan.
- Agent presence is inferred only from the existence of `~/.claude`, `~/.claude.json`,
  `~/.codex` (`CODEX_HOME`), `~/.cursor` and Cursor's application-data folder. Their contents are
  never read.

## Agent Skills format

All three agents follow the open Agent Skills format (<https://agentskills.io/specification>):
a skill is a directory with a `SKILL.md` file whose YAML frontmatter has `name` (1–64 chars,
lowercase alphanumerics and single hyphens, matching the directory) and `description`
(1–1024 chars). SkillScope validates against that format and reports agent-specific
differences as compatibility warnings.
