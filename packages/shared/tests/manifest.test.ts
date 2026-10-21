import { describe, expect, it } from 'vitest';
import { parseAgentSkillManifest } from '../src/index.js';

const valid = {
  schemaVersion: 1,
  skills: [{ name: 'code-review', path: 'skills/code-review', agents: ['claude', 'codex', 'cursor'] }],
};

describe('agent-skill.json manifest', () => {
  it('accepts a valid manifest', () => {
    const r = parseAgentSkillManifest(JSON.stringify(valid));
    expect(r.errors).toEqual([]);
    expect(r.manifest?.skills[0]?.path).toBe('skills/code-review');
  });

  it('normalises a leading ./ and trailing slash', () => {
    const r = parseAgentSkillManifest(
      JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: './skills/a/', agents: ['claude'] }] }),
    );
    expect(r.manifest?.skills[0]?.path).toBe('skills/a');
  });

  it('accepts multiple skills', () => {
    const r = parseAgentSkillManifest(
      JSON.stringify({
        schemaVersion: 1,
        skills: [
          { name: 'a', path: 'skills/a', agents: ['claude'] },
          { name: 'b', path: 'skills/b', agents: ['codex', 'cursor'] },
        ],
      }),
    );
    expect(r.manifest?.skills).toHaveLength(2);
  });

  it.each([
    ['invalid JSON', '{'],
    ['unsupported schema version', JSON.stringify({ ...valid, schemaVersion: 2 })],
    ['missing skills', JSON.stringify({ schemaVersion: 1 })],
    ['empty skills', JSON.stringify({ schemaVersion: 1, skills: [] })],
    ['uppercase name', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'Bad', path: 'a', agents: ['claude'] }] })],
    ['double hyphen', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a--b', path: 'a', agents: ['claude'] }] })],
    ['unknown agent', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: 'a', agents: ['vim'] }] })],
    ['no agents', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: 'a', agents: [] }] })],
    ['absolute path', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: '/etc/a', agents: ['claude'] }] })],
    ['windows absolute path', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: 'C:/a', agents: ['claude'] }] })],
    ['backslashes', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: 'skills\\a', agents: ['claude'] }] })],
    ['traversal', JSON.stringify({ schemaVersion: 1, skills: [{ name: 'a', path: 'skills/../../a', agents: ['claude'] }] })],
    [
      'duplicate names',
      JSON.stringify({
        schemaVersion: 1,
        skills: [
          { name: 'a', path: 'x', agents: ['claude'] },
          { name: 'a', path: 'y', agents: ['claude'] },
        ],
      }),
    ],
    [
      'nested skill paths',
      JSON.stringify({
        schemaVersion: 1,
        skills: [
          { name: 'a', path: 'skills/a', agents: ['claude'] },
          { name: 'b', path: 'skills/a/b', agents: ['claude'] },
        ],
      }),
    ],
  ])('rejects %s', (_label, raw) => {
    const r = parseAgentSkillManifest(raw);
    expect(r.manifest).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
