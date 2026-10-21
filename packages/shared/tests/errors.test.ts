import { describe, expect, it } from 'vitest';
import { SkillScopeError, err, ok, redactSecrets, toSerializedError } from '../src/index.js';

describe('errors', () => {
  it('wraps results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err({ code: 'NOT_FOUND', message: 'x' })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'x' },
    });
  });

  it('serialises SkillScopeError with hint and details', () => {
    const e = new SkillScopeError('TARGET_CONFLICT', 'exists', { hint: 'review', details: ['a'] });
    expect(toSerializedError(e)).toEqual({ code: 'TARGET_CONFLICT', message: 'exists', hint: 'review', details: ['a'] });
  });

  it.each([
    ['EACCES', 'PERMISSION_DENIED'],
    ['EPERM', 'PERMISSION_DENIED'],
    ['EBUSY', 'FILE_LOCKED'],
    ['ENOENT', 'NOT_FOUND'],
    ['ENAMETOOLONG', 'PATH_TOO_LONG'],
  ])('maps errno %s to %s with a hint', (errno, code) => {
    const e = Object.assign(new Error(`${errno}: failed`), { code: errno });
    const s = toSerializedError(e);
    expect(s.code).toBe(code);
    expect(s.hint).toBeTruthy();
  });

  it('maps unknown values to INTERNAL', () => {
    expect(toSerializedError('boom').code).toBe('INTERNAL');
  });

  it('redacts tokens, auth headers and URL credentials', () => {
    const input =
      'token=abc123 npm_abcdefghijklmnopqrstuvwxyz0123 Authorization: Bearer xyz https://user:pass@registry.example.com/pkg //registry/:_authToken=secret';
    const out = redactSecrets(input);
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('npm_abcdefghijklmnopqrstuvwxyz0123');
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('user:pass');
    expect(out).not.toContain('secret');
    expect(out).toContain('registry.example.com/pkg');
  });

  it('redacts secrets inside serialised error messages', () => {
    const e = new Error('GET https://me:hunter2@registry.example.com failed');
    expect(toSerializedError(e).message).not.toContain('hunter2');
  });
});
