# SkillScope 0.1.0

The first release of SkillScope, a desktop app that shows which agent skills are on your computer
and which coding agents can reach them, and installs skills from npm into Claude Code, OpenAI
Codex and Cursor independently.

## What you can do

- **See every skill** in the documented folders for Claude Code, Codex and Cursor, at user,
  project and system level, in one searchable inventory.
- **See who can reach each skill.** The reach map shows whether an agent finds a skill in its
  own folder or in a folder it also reads (for example, Cursor reading `~/.claude/skills`). A
  skill in a shared folder appears once, with one entry per agent.
- **Find problems:** missing `SKILL.md`, invalid frontmatter, broken references, links that
  leave the skill folder, identical copies and name clashes, plus per-agent compatibility
  warnings. Every finding has a suggested next step.
- **Install from npm safely.** Packages are checked against the registry's SHA-512 integrity
  hash, unpacked in memory with links, devices and path traversal rejected, staged in a private
  folder and validated before you confirm. Package scripts are never run.
- **Install per agent**, at global or project scope, with conflict review, backups and
  all-or-nothing rollback. Install a shared copy into `.agents/skills` only when you choose to.
- **Update and remove** only the files SkillScope installed. Files you added or changed are kept
  unless you say otherwise.
- **Export** the inventory as JSON, CSV or Markdown.
- Light and dark themes, offline viewing of the last scan, and no telemetry.

## Known limitations

- Installers are not code signed. Windows SmartScreen will warn on first run.
- Windows support is verified by CI only; the app was developed and manually tested on Linux.
- Only the selected workspace root is scanned for project skills. Nested `.claude/skills` or
  `.cursor/skills` folders in subdirectories, Codex's parent-directory walk, Claude Code plugin
  skills and `--add-dir` folders are not scanned.
- The Claude Code enterprise skill path on Windows and macOS is inferred, not documented.
- Finding a skill on disk does not prove that an agent has loaded it.
- npm installation follows SkillScope's own `agent-skill.json` convention
  ([docs/npm-skill-packages.md](npm-skill-packages.md)). Packages without it are accepted only in
  the unambiguous `skills/<name>/SKILL.md` layout.
- Private registries that need authentication are not supported. Credentials are never stored.
- The `.deb` installs system-wide (as all `.deb` packages do); use the AppImage for a user-only
  install.
