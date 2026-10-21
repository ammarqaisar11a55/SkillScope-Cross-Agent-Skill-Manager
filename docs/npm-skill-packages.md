# npm skill packages (`agent-skill.json`, schema version 1)

SkillScope installs skills distributed as npm packages. The `agent-skill.json` manifest described
here is a **SkillScope-owned convention**. It is not an npm standard and not part of any agent's
specification. Its job is to say, without guessing, which folders in a package are skills and
which agents the author intends them for.

## Package layout

```text
package.json
agent-skill.json
skills/
  code-review/
    SKILL.md
    references/
    scripts/
    assets/
  test-writer/
    SKILL.md
```

Only the declared skill folders are installed. Everything else in the package (`package.json`,
docs, source code, `node_modules`) is ignored.

## Manifest

```json
{
  "schemaVersion": 1,
  "skills": [
    {
      "name": "code-review",
      "path": "skills/code-review",
      "agents": ["claude", "codex", "cursor"]
    },
    { "name": "test-writer", "path": "skills/test-writer", "agents": ["claude", "cursor"] }
  ]
}
```

### Fields

| Field                  | Required | Rules                                                                                                                                                                                                            |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | yes      | Must be `1`. Other values are rejected with "update SkillScope".                                                                                                                                                 |
| `skills`               | yes      | 1–100 entries.                                                                                                                                                                                                   |
| `skills[].name`        | yes      | 1–64 characters, lowercase letters, digits and single hyphens (Agent Skills rule). Becomes the installed folder name. Must equal the `name` in the skill's `SKILL.md`. Unique within the package.                |
| `skills[].path`        | yes      | Relative POSIX path inside the package. No leading `/`, no drive letter, no `\`, no `.` or `..` segments. A leading `./` or trailing `/` is normalised away. Unique. One skill may not be nested inside another. |
| `skills[].agents`      | yes      | At least one of `claude`, `codex`, `cursor`.                                                                                                                                                                     |
| `skills[].description` | no       | Up to 1024 characters. Shown when `SKILL.md` has none.                                                                                                                                                           |
| `homepage`             | no       | A URL.                                                                                                                                                                                                           |

Each declared folder must contain a `SKILL.md` that passes validation
([supported-paths.md](supported-paths.md#agent-skills-format)). A skill with validation errors
cannot be installed. Warnings are shown but do not block installation.

### Agent identifiers and compatibility

`agents` is the **author's claim**. SkillScope uses it to:

- pre-select target agents in the install dialog,
- warn when you install a skill for an agent it does not declare,
- run compatibility checks only for the declared agents (all three when none are declared).

It never treats the claim as proof that a skill behaves the same in every agent.

## Packages without `agent-skill.json`

A missing manifest does not make a package trustworthy or compatible. SkillScope accepts it only
when the layout is unambiguous:

- every skill is at `skills/<name>/SKILL.md`, and
- there is no other `SKILL.md` anywhere in the package.

Such packages are labelled **No agent-skill.json** and get a warning, and no agents are
pre-selected. A package with a root `SKILL.md`, or one mixing layouts, is rejected as ambiguous.
A package with no skills at all is reported as "not a skill package".

## Multi-skill packages

You choose which skills to install. Each (skill, destination) pair gets its own installation
receipt, so you can update or remove one skill without touching its siblings from the same
package.

## Versioning and updates

- Use semantic versioning. SkillScope offers an update when the registry's `latest` dist-tag is
  greater than the installed version.
- An update replaces exactly one installed skill folder with the same-named skill from the new
  version. If the new version no longer contains that skill, the update is refused.
- Files changed by the user since installation block the update until they confirm. The old
  folder is kept as a backup.

## Discoverability

Add keywords to `package.json` so the Marketplace search finds the package:

| Keyword             | Meaning                   |
| ------------------- | ------------------------- |
| `agent-skill`       | Any agent skill package   |
| `claude-code-skill` | Intended for Claude Code  |
| `codex-skill`       | Intended for OpenAI Codex |
| `cursor-skill`      | Intended for Cursor       |

Keywords help discovery only. They are not used for validation.

## What SkillScope does with a package

1. Reads registry metadata and validates the package name and version.
2. Downloads the tarball (https only, 50 MB limit).
3. Verifies `dist.integrity` (SHA-512). A mismatch aborts before anything is written. Versions
   with only a SHA-1 `shasum` are flagged; versions with neither cannot be installed.
4. Unpacks in memory. It rejects symlinks, hard links, devices, FIFOs, absolute paths, `..`
   traversal, backslashes, names Windows cannot represent, duplicate or case-colliding entries,
   files over 20 MB and packages over 100 MB unpacked.
5. Writes the files into a private staging folder under SkillScope's data directory.
6. Validates the manifest and each skill.
7. Shows you the contents, targets and conflicts and asks for confirmation.

It **never** runs `preinstall`, `install`, `postinstall`, `prepare` or any other script, and never
installs the package's dependencies. Declared lifecycle scripts are listed so you know they
exist.

## Unsupported

- Private or authenticated registries.
- Skills outside a declared folder, or symlinked content inside a package.
- Installing a package's dependencies.
- Schema versions other than `1`.
