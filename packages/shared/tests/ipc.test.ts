import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isIpcChannel, validateIpcPayload } from '../src/index.js';

describe('IPC payload validation', () => {
  it('knows every channel', () => {
    expect(IPC_CHANNELS).toContain('inventory:scan');
    expect(isIpcChannel('inventory:scan')).toBe(true);
    expect(isIpcChannel('fs:readFile')).toBe(false);
    expect(isIpcChannel('__proto__')).toBe(false);
  });

  it('accepts valid payloads', () => {
    expect(validateIpcPayload('inventory:scan', undefined).ok).toBe(true);
    expect(validateIpcPayload('registry:details', { name: '@scope/my-skill' }).ok).toBe(true);
    expect(validateIpcPayload('packages:inspect', { name: 'skill-pack', version: '1.2.3-beta.1' }).ok).toBe(true);
  });

  it('rejects payloads for no-argument channels', () => {
    expect(validateIpcPayload('inventory:scan', { path: '/' }).ok).toBe(false);
  });

  it.each([
    ['uppercase package', 'registry:details', { name: 'Bad' }],
    ['path in package name', 'registry:details', { name: '../etc/passwd' }],
    ['traversal file path', 'inventory:read-file', { skillId: 'abc', path: '../../secret' }],
    ['absolute file path', 'inventory:read-file', { skillId: 'abc', path: '/etc/passwd' }],
    ['windows file path', 'inventory:read-file', { skillId: 'abc', path: 'C:\\Windows' }],
    ['unknown agent', 'install:plan', { stagingId: 's', skills: ['a'], targets: [{ agentId: 'vim', scope: 'global' }], allowSharedInstall: false }],
    ['no targets', 'install:plan', { stagingId: 's', skills: ['a'], targets: [], allowSharedInstall: false }],
    ['bad id', 'removal:preview', { receiptId: 'a b/c' }],
    ['bad export format', 'export:inventory', { format: 'xml' }],
    ['settings with bad theme', 'settings:update', { theme: 'neon' }],
  ] as const)('rejects %s', (_label, channel, payload) => {
    const r = validateIpcPayload(channel, payload);
    expect(r.ok).toBe(false);
  });
});
