import { z } from 'zod';
import { AGENT_IDS } from '../types/agents.js';
import type { Settings } from '../types/settings.js';

export const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

export const customSkillLocationSchema = z.object({
  id: z.string().min(1).max(100),
  agentId: z.enum(AGENT_IDS),
  scope: z.enum(['global', 'project']),
  path: z.string().min(1).max(4096),
  label: z.string().min(1).max(120),
  installable: z.boolean(),
});

export const settingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  defaultScope: z.enum(['global', 'project']),
  workspaceRoot: z.string().min(1).max(4096).nullable(),
  customLocations: z.array(customSkillLocationSchema).max(50),
  registry: z.object({
    url: z
      .string()
      .url()
      .refine(
        (u) =>
          u.startsWith('https://') ||
          u.startsWith('http://localhost') ||
          u.startsWith('http://127.0.0.1'),
        {
          message: 'registry URL must use https (http is only allowed for localhost)',
        },
      )
      .refine((u) => !/\/\/[^/]*@/.test(u), { message: 'registry URL must not embed credentials' }),
    timeoutMs: z.number().int().min(1000).max(120000),
    retries: z.number().int().min(0).max(5),
  }),
  scan: z.object({
    followSymlinks: z.boolean(),
    includeSystemRoots: z.boolean(),
    scanOnStartup: z.boolean(),
    maxDepth: z.number().int().min(1).max(6),
  }),
  historyRetentionDays: z.number().int().min(1).max(3650),
  privacy: z.object({
    allowNetwork: z.boolean(),
  }),
});

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultScope: 'global',
  workspaceRoot: null,
  customLocations: [],
  registry: { url: DEFAULT_REGISTRY_URL, timeoutMs: 15000, retries: 2 },
  scan: { followSymlinks: true, includeSystemRoots: true, scanOnStartup: true, maxDepth: 4 },
  historyRetentionDays: 180,
  privacy: { allowNetwork: true },
};

/** Settings patch accepted from the UI: any subset of top-level sections. */
export const settingsPatchSchema = settingsSchema.partial();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Merge a stored (possibly older or partial) settings object over the defaults. */
export function normalizeSettings(raw: unknown): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const merged = {
    ...base,
    ...r,
    registry: { ...base.registry, ...(r.registry as object | undefined) },
    scan: { ...base.scan, ...(r.scan as object | undefined) },
    privacy: { ...base.privacy, ...(r.privacy as object | undefined) },
  };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}
