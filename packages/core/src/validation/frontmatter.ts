import { parseDocument } from 'yaml';

export interface ParsedSkillMarkdown {
  hasFrontmatter: boolean;
  frontmatter: Record<string, unknown>;
  body: string;
  /** YAML or structure error, with a 1-based line number in SKILL.md when known. */
  error: { message: string; line: number | null } | null;
  lineCount: number;
}

const OPEN = /^---[ \t]*$/;

/**
 * Split SKILL.md into YAML frontmatter and Markdown body. The frontmatter must start on the
 * first line. Parsing never throws; problems are reported in `error`.
 */
export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const result: ParsedSkillMarkdown = {
    hasFrontmatter: false,
    frontmatter: {},
    body: text,
    error: null,
    lineCount: lines.length,
  };
  if (!OPEN.test(lines[0] ?? '')) return result;

  const closeIndex = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)[ \t]*$/.test(line));
  if (closeIndex === -1) {
    result.error = { message: 'Frontmatter starts with "---" but is never closed.', line: 1 };
    return result;
  }
  result.hasFrontmatter = true;
  result.body = lines.slice(closeIndex + 1).join('\n');
  const yamlSource = lines.slice(1, closeIndex).join('\n');

  const doc = parseDocument(yamlSource, { prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const line = first?.linePos?.[0]?.line;
    result.error = {
      message: `YAML frontmatter is invalid: ${first?.message.split('\n')[0] ?? 'parse error'}`,
      line: typeof line === 'number' ? line + 1 : null,
    };
    return result;
  }
  const value: unknown = doc.toJS({ maxAliasCount: 50 });
  if (value === null || value === undefined) return result;
  if (typeof value !== 'object' || Array.isArray(value)) {
    result.error = { message: 'Frontmatter must be a YAML mapping of keys to values.', line: 2 };
    return result;
  }
  result.frontmatter = value as Record<string, unknown>;
  return result;
}

export function stringField(frontmatter: Record<string, unknown>, key: string): string | null {
  const value = frontmatter[key];
  return typeof value === 'string' ? value : null;
}
