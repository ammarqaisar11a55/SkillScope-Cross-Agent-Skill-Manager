import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  createPlatformContext,
  extractReferences,
  parseSkillMarkdown,
  readSkillTree,
  resolveReference,
  validateSkill,
} from '../src/index.js';
import { FIXTURES } from './helpers.js';

const registry = new AdapterRegistry();
const ctx = createPlatformContext();

async function validateFixture(name: string, agents: ('claude' | 'codex' | 'cursor')[] = []) {
  const dir = join(FIXTURES, 'skills', name);
  const tree = await readSkillTree(dir, ctx);
  const content = await readFile(join(dir, 'SKILL.md'), 'utf8');
  return validateSkill({
    directoryName: name,
    skillFileName: 'SKILL.md',
    content,
    files: tree.files,
    caseSensitive: true,
    adapters: agents.map((a) => registry.get(a)),
  });
}

function codes(result: Awaited<ReturnType<typeof validateFixture>>): string[] {
  return result.report.issues.map((i) => i.code);
}

describe('frontmatter parsing', () => {
  it('parses a mapping and body, tolerating BOM and CRLF', () => {
    const parsed = parseSkillMarkdown('\uFEFF---\r\nname: a\r\ndescription: b\r\n---\r\nBody\r\n');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter).toEqual({ name: 'a', description: 'b' });
    expect(parsed.body.trim()).toBe('Body');
  });

  it('reports YAML errors with a line number instead of throwing', () => {
    const parsed = parseSkillMarkdown('---\nname: a\n  bad: [\n---\n');
    expect(parsed.error?.message).toMatch(/YAML frontmatter is invalid/);
  });

  it('rejects non-mapping frontmatter', () => {
    expect(parseSkillMarkdown('---\n- a\n- b\n---\n').error?.message).toMatch(/mapping/);
  });

  it('rejects duplicate keys', () => {
    expect(parseSkillMarkdown('---\nname: a\nname: b\n---\n').error).not.toBeNull();
  });

  it('treats a file without leading --- as having no frontmatter', () => {
    const parsed = parseSkillMarkdown('# Title\n---\nname: x\n---\n');
    expect(parsed.hasFrontmatter).toBe(false);
  });
});

describe('reference extraction', () => {
  it('finds relative links and ignores URLs, anchors and code', () => {
    const refs = extractReferences(
      'See [a](references/a.md#x), ![img](assets/i.png), [web](https://x.y), [anchor](#top), `[c](code.md)`\n```\n[d](block.md)\n```',
    );
    expect(refs.sort()).toEqual(['assets/i.png', 'references/a.md']);
  });

  it('resolves references and rejects escapes', () => {
    expect(resolveReference('./a/../b.md')).toBe('b.md');
    expect(resolveReference('../x')).toBeNull();
    expect(resolveReference('/etc/passwd')).toBeNull();
    expect(resolveReference('C:\\x')).toBeNull();
  });
});

describe('skill validation', () => {
  it('accepts a complete skill with only an informational note about scripts', async () => {
    const result = await validateFixture('valid-full', ['claude', 'codex', 'cursor']);
    expect(result.report.state).toBe('valid');
    expect(result.name).toBe('valid-full');
    expect(codes(result)).toEqual(['security.bundled-scripts']);
  });

  it.each([
    ['missing-name', 'metadata.name-missing', 'invalid'],
    ['missing-description', 'metadata.description-missing', 'invalid'],
    ['bad-yaml', 'metadata.yaml-invalid', 'invalid'],
    ['unclosed-frontmatter', 'metadata.yaml-invalid', 'invalid'],
    ['no-frontmatter', 'metadata.no-frontmatter', 'invalid'],
    ['Upper_Case', 'metadata.name-format', 'invalid'],
    ['outside-reference', 'references.outside-skill', 'invalid'],
    ['name-mismatch', 'metadata.name-directory-mismatch', 'warnings'],
    ['missing-reference', 'references.missing', 'warnings'],
  ])('%s → %s (%s)', async (fixture, code, state) => {
    const result = await validateFixture(fixture);
    expect(codes(result)).toContain(code);
    expect(result.report.state).toBe(state);
    for (const i of result.report.issues) {
      expect(i.message.length).toBeGreaterThan(10);
      expect(i.hint.length).toBeGreaterThan(5);
    }
  });

  it('reports a missing SKILL.md as a structural error', () => {
    const result = validateSkill({
      directoryName: 'x',
      skillFileName: null,
      content: null,
      files: [],
      caseSensitive: true,
      adapters: [],
    });
    expect(result.report.state).toBe('invalid');
    expect(result.report.issues[0]?.code).toBe('structure.missing-skill-md');
  });

  it('treats a lowercase skill.md as an error on case-sensitive systems and a warning elsewhere', () => {
    const base = {
      directoryName: 'x',
      skillFileName: 'skill.md',
      content: '---\nname: x\ndescription: d\n---\n',
      files: [],
      adapters: [],
    };
    expect(validateSkill({ ...base, caseSensitive: true }).report.state).toBe('invalid');
    expect(validateSkill({ ...base, caseSensitive: false }).report.state).toBe('warnings');
  });

  it('enforces name and description length limits', () => {
    const long = validateSkill({
      directoryName: 'a'.repeat(65),
      skillFileName: 'SKILL.md',
      content: `---\nname: ${'a'.repeat(65)}\ndescription: ${'d'.repeat(1025)}\n---\n`,
      files: [],
      caseSensitive: true,
      adapters: [],
    });
    expect(long.report.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['metadata.name-length', 'metadata.description-length']),
    );
  });

  it('separates structural validity from agent compatibility', async () => {
    const result = await validateFixture('name-mismatch', ['claude', 'cursor', 'codex']);
    const compat = result.report.issues.filter((i) => i.category === 'compatibility');
    expect(compat.map((i) => i.agentId).sort()).toEqual(['codex', 'cursor']);
    expect(compat.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags Claude-reserved names as a hard incompatibility for Claude only', () => {
    const result = validateSkill({
      directoryName: 'anthropic-skills',
      skillFileName: 'SKILL.md',
      content: '---\nname: anthropic-skills\ndescription: d\n---\n',
      files: [],
      caseSensitive: true,
      adapters: [registry.get('claude'), registry.get('cursor')],
    });
    const reserved = result.report.issues.find((i) => i.code === 'compat.claude.reserved-name');
    expect(reserved?.agentId).toBe('claude');
  });

  it('warns about symlinks that point outside the skill', () => {
    const result = validateSkill({
      directoryName: 'x',
      skillFileName: 'SKILL.md',
      content: '---\nname: x\ndescription: d\n---\n',
      files: [
        { path: 'secret', kind: 'symlink', size: 0, sha256: 'h', linkTarget: '../../.ssh/id_rsa' },
        { path: 'ok', kind: 'symlink', size: 0, sha256: 'h', linkTarget: 'references/a.md' },
      ],
      caseSensitive: true,
      adapters: [],
    });
    const escapes = result.report.issues.filter((i) => i.code === 'security.symlink-escape');
    expect(escapes.map((i) => i.path)).toEqual(['secret']);
  });
});
