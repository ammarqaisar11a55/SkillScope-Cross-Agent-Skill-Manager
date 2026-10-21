import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, settingsSchema } from '../src/index.js';

describe('settings', () => {
  it('defaults are valid', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('fills missing sections from defaults', () => {
    const s = normalizeSettings({ theme: 'dark', registry: { timeoutMs: 5000 } });
    expect(s.theme).toBe('dark');
    expect(s.registry.timeoutMs).toBe(5000);
    expect(s.registry.url).toBe(DEFAULT_SETTINGS.registry.url);
    expect(s.scan).toEqual(DEFAULT_SETTINGS.scan);
  });

  it('falls back to defaults on corrupted input', () => {
    expect(normalizeSettings({ theme: 'neon' })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects insecure or credentialed registry URLs', () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    expect(settingsSchema.safeParse({ ...base, registry: { ...base.registry, url: 'http://evil.example.com' } }).success).toBe(false);
    expect(
      settingsSchema.safeParse({ ...base, registry: { ...base.registry, url: 'https://u:p@registry.example.com' } }).success,
    ).toBe(false);
    expect(settingsSchema.safeParse({ ...base, registry: { ...base.registry, url: 'http://localhost:4873' } }).success).toBe(true);
  });
});
