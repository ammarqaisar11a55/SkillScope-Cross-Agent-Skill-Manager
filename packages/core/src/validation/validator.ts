import type { ValidationIssue, ValidationReport, ValidationState } from '@skillscope/shared';
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
} from '@skillscope/shared';
import type { AgentAdapter } from '../agents/types.js';
import type { SkillTreeFile } from '../inventory/files.js';
import { parseSkillMarkdown, stringField, type ParsedSkillMarkdown } from './frontmatter.js';

export const SKILL_MD_MAX_BYTES = 1024 * 1024;
export const SKILL_MD_RECOMMENDED_LINES = 500;
export const COMPATIBILITY_MAX_LENGTH = 500;

export interface SkillValidationInput {
  directoryName: string;
  /** Name of the skill file actually present (e.g. "skill.md"), or null when missing. */
  skillFileName: string | null;
  /** SKILL.md content, or null when it is missing or unreadable. */
  content: string | null;
  readError?: string | null;
  files: SkillTreeFile[];
  /** True on platforms where agents look up SKILL.md case-sensitively. */
  caseSensitive: boolean;
  /** Adapters of the agents that can see this skill, for compatibility checks. */
  adapters: AgentAdapter[];
}

export interface SkillValidationResult {
  report: ValidationReport;
  parsed: ParsedSkillMarkdown | null;
  name: string | null;
  description: string | null;
}

function issue(
  code: string,
  severity: ValidationIssue['severity'],
  category: ValidationIssue['category'],
  message: string,
  hint: string,
  path?: string,
): ValidationIssue {
  const out: ValidationIssue = { code, severity, category, message, hint };
  if (path) out.path = path;
  return out;
}

export function stateFor(issues: ValidationIssue[]): ValidationState {
  if (issues.some((i) => i.severity === 'error')) return 'invalid';
  if (issues.some((i) => i.severity === 'warning')) return 'warnings';
  return 'valid';
}

/** Markdown link and image targets: [text](target) and ![alt](target). */
const LINK_PATTERN = /!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export function extractReferences(body: string): string[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const refs = new Set<string>();
  for (const match of withoutCode.matchAll(LINK_PATTERN)) {
    const target = match[1];
    if (!target) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//'))
      continue;
    const clean = target.split('#')[0]?.split('?')[0] ?? '';
    if (!clean) continue;
    try {
      refs.add(decodeURIComponent(clean));
    } catch {
      refs.add(clean);
    }
  }
  return [...refs];
}

/** Resolve a reference relative to the skill root; returns null if it escapes the root. */
export function resolveReference(reference: string): string | null {
  if (reference.startsWith('/') || reference.startsWith('\\') || /^[A-Za-z]:/.test(reference))
    return null;
  const parts: string[] = [];
  for (const seg of reference.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

function linkEscapes(target: string, linkPath: string): boolean {
  if (target.startsWith('/') || target.startsWith('\\') || /^[A-Za-z]:/.test(target)) return true;
  const dir = linkPath.includes('/') ? linkPath.slice(0, linkPath.lastIndexOf('/')) : '';
  return resolveReference(dir ? `${dir}/${target}` : target) === null;
}

/**
 * Structural and metadata validation against the Agent Skills format, followed by
 * agent-specific compatibility checks. Never modifies the skill.
 */
export function validateSkill(input: SkillValidationInput): SkillValidationResult {
  const issues: ValidationIssue[] = [];
  let parsed: ParsedSkillMarkdown | null = null;
  let name: string | null = null;
  let description: string | null = null;

  if (!input.skillFileName) {
    issues.push(
      issue(
        'structure.missing-skill-md',
        'error',
        'structure',
        'The directory has no SKILL.md file, so no agent will load it as a skill.',
        'Add a SKILL.md with name and description frontmatter, or remove the folder if it is not a skill.',
      ),
    );
  } else if (input.skillFileName !== 'SKILL.md') {
    issues.push(
      issue(
        'structure.skill-md-case',
        input.caseSensitive ? 'error' : 'warning',
        'structure',
        `The skill file is named "${input.skillFileName}"; agents look for "SKILL.md".`,
        'Rename the file to SKILL.md (upper case).',
        input.skillFileName,
      ),
    );
  }

  if (input.skillFileName && input.content === null) {
    issues.push(
      issue(
        'structure.unreadable',
        'error',
        'structure',
        `SKILL.md cannot be read${input.readError ? `: ${input.readError}` : ''}.`,
        'Check the file permissions.',
        input.skillFileName,
      ),
    );
  }

  if (input.content !== null) {
    parsed = parseSkillMarkdown(input.content);
    const file = input.skillFileName ?? 'SKILL.md';
    if (Buffer.byteLength(input.content) > SKILL_MD_MAX_BYTES) {
      issues.push(
        issue(
          'structure.skill-md-large',
          'warning',
          'structure',
          'SKILL.md is larger than 1 MB.',
          'Move reference material into separate files.',
          file,
        ),
      );
    } else if (parsed.lineCount > SKILL_MD_RECOMMENDED_LINES) {
      issues.push(
        issue(
          'structure.skill-md-long',
          'info',
          'structure',
          `SKILL.md has ${parsed.lineCount} lines; under ${SKILL_MD_RECOMMENDED_LINES} is recommended.`,
          'Move detailed reference material into references/.',
          file,
        ),
      );
    }

    if (parsed.error) {
      issues.push(
        issue(
          'metadata.yaml-invalid',
          'error',
          'metadata',
          parsed.error.line
            ? `${parsed.error.message} (line ${parsed.error.line})`
            : parsed.error.message,
          'Fix the YAML between the --- markers. Quote values that contain ":" or "#".',
          file,
        ),
      );
    } else if (!parsed.hasFrontmatter) {
      issues.push(
        issue(
          'metadata.no-frontmatter',
          'error',
          'metadata',
          'SKILL.md has no YAML frontmatter. The Agent Skills format requires name and description.',
          'Start the file with ---, then "name:" and "description:" lines, then ---.',
          file,
        ),
      );
    } else {
      const fm = parsed.frontmatter;
      name = stringField(fm, 'name');
      description = stringField(fm, 'description');

      if (fm.name === undefined) {
        issues.push(
          issue(
            'metadata.name-missing',
            'error',
            'metadata',
            'Frontmatter has no "name".',
            `Add "name: ${input.directoryName}".`,
            file,
          ),
        );
      } else if (name === null || name.trim() === '') {
        issues.push(
          issue(
            'metadata.name-type',
            'error',
            'metadata',
            '"name" must be a non-empty string.',
            'Set name to a plain string.',
            file,
          ),
        );
        name = null;
      } else {
        if (name.length > SKILL_NAME_MAX_LENGTH) {
          issues.push(
            issue(
              'metadata.name-length',
              'error',
              'metadata',
              `"name" is ${name.length} characters; the limit is ${SKILL_NAME_MAX_LENGTH}.`,
              'Shorten the name.',
              file,
            ),
          );
        }
        if (!SKILL_NAME_PATTERN.test(name)) {
          issues.push(
            issue(
              'metadata.name-format',
              'error',
              'metadata',
              `"name" ("${name}") must use lowercase letters, digits and single hyphens, without leading or trailing hyphens.`,
              'Rename the skill, e.g. "my-skill".',
              file,
            ),
          );
        }
        if (name !== input.directoryName) {
          issues.push(
            issue(
              'metadata.name-directory-mismatch',
              'warning',
              'metadata',
              `"name" ("${name}") does not match the directory name ("${input.directoryName}").`,
              'Rename the directory or the frontmatter name so they match.',
              file,
            ),
          );
        }
      }

      if (fm.description === undefined) {
        issues.push(
          issue(
            'metadata.description-missing',
            'error',
            'metadata',
            'Frontmatter has no "description".',
            'Describe what the skill does and when to use it.',
            file,
          ),
        );
      } else if (description === null || description.trim() === '') {
        issues.push(
          issue(
            'metadata.description-type',
            'error',
            'metadata',
            '"description" must be a non-empty string.',
            'Set a plain-text description.',
            file,
          ),
        );
        description = null;
      } else if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
        issues.push(
          issue(
            'metadata.description-length',
            'error',
            'metadata',
            `"description" is ${description.length} characters; the limit is ${SKILL_DESCRIPTION_MAX_LENGTH}.`,
            'Shorten the description and move details into the body.',
            file,
          ),
        );
      }

      const compatibility = fm.compatibility;
      if (
        compatibility !== undefined &&
        (typeof compatibility !== 'string' ||
          compatibility.length > COMPATIBILITY_MAX_LENGTH ||
          compatibility.length === 0)
      ) {
        issues.push(
          issue(
            'metadata.compatibility-invalid',
            'warning',
            'metadata',
            `"compatibility" must be a string of 1–${COMPATIBILITY_MAX_LENGTH} characters.`,
            'Shorten or fix the compatibility field.',
            file,
          ),
        );
      }
      const metadata = fm.metadata;
      if (
        metadata !== undefined &&
        (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
      ) {
        issues.push(
          issue(
            'metadata.metadata-invalid',
            'warning',
            'metadata',
            '"metadata" must be a mapping of keys to values.',
            'Use "metadata:" followed by indented key: value pairs.',
            file,
          ),
        );
      }
      const allowed = fm['allowed-tools'];
      if (allowed !== undefined && typeof allowed !== 'string' && !Array.isArray(allowed)) {
        issues.push(
          issue(
            'metadata.allowed-tools-invalid',
            'warning',
            'metadata',
            '"allowed-tools" should be a space-separated string.',
            'Write allowed-tools as a single string.',
            file,
          ),
        );
      }
    }

    // References in the body must exist and stay inside the skill directory.
    const known = new Set(input.files.map((f) => f.path));
    for (const ref of extractReferences(parsed.body)) {
      const resolved = resolveReference(ref);
      if (resolved === null) {
        issues.push(
          issue(
            'references.outside-skill',
            'error',
            'security',
            `SKILL.md references "${ref}", which is outside the skill directory.`,
            'Bundle the file inside the skill and use a relative path.',
            file,
          ),
        );
      } else if (resolved !== '' && !known.has(resolved)) {
        issues.push(
          issue(
            'references.missing',
            'warning',
            'references',
            `SKILL.md references "${ref}", which does not exist.`,
            'Add the file or fix the link.',
            file,
          ),
        );
      }
    }
  }

  for (const f of input.files) {
    if (f.kind === 'symlink' && f.linkTarget !== undefined && linkEscapes(f.linkTarget, f.path)) {
      issues.push(
        issue(
          'security.symlink-escape',
          'warning',
          'security',
          `"${f.path}" is a symbolic link to "${f.linkTarget}", outside the skill.`,
          'Replace the link with a copy of the file, or review where it points.',
          f.path,
        ),
      );
    } else if (f.kind === 'other') {
      issues.push(
        issue(
          'security.special-file',
          'warning',
          'security',
          `"${f.path}" is not a regular file or directory.`,
          'Remove devices, sockets or pipes from the skill.',
          f.path,
        ),
      );
    }
  }
  if (input.files.some((f) => f.kind === 'file' && f.path.startsWith('scripts/'))) {
    issues.push(
      issue(
        'security.bundled-scripts',
        'info',
        'security',
        'The skill bundles scripts that an agent may run.',
        'Review scripts/ before relying on this skill, especially if it came from a third party.',
        'scripts',
      ),
    );
  }

  if (parsed && !parsed.error) {
    const view = {
      name,
      directoryName: input.directoryName,
      frontmatter: parsed.frontmatter,
      hasFrontmatter: parsed.hasFrontmatter,
      files: input.files.map((f) => f.path),
    };
    for (const adapter of input.adapters) issues.push(...adapter.checkCompatibility(view));
  }

  return { report: { state: stateFor(issues), issues }, parsed, name, description };
}
