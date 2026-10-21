import { z } from 'zod';
import { AGENT_IDS } from '../types/agents.js';
import { settingsPatchSchema } from './settings.js';

/**
 * Every IPC channel and the schema its payload must satisfy. The main process rejects any
 * payload that fails validation before it reaches the service layer.
 */
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/, 'invalid identifier');

/** npm package names: optionally scoped, lowercase URL-safe characters, at most 214 chars. */
const packageName = z
  .string()
  .min(1)
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/, 'invalid npm package name');

const version = z.string().min(1).max(256).regex(/^[0-9A-Za-z.+-]+$/, 'invalid version');

const relativePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\\'), 'must be relative')
  .refine((p) => !p.split('/').includes('..'), 'must not traverse');

export const ipcSchemas = {
  'app:info': z.undefined(),
  'inventory:scan': z.undefined(),
  'inventory:cached': z.undefined(),
  'inventory:skill-details': z.object({ skillId: id }),
  'inventory:read-file': z.object({ skillId: id, path: relativePath }),
  'inventory:reveal': z.object({ skillId: id }),
  'registry:search': z.object({
    text: z.string().max(200),
    agents: z.array(z.enum(AGENT_IDS)).max(3).optional(),
    from: z.number().int().min(0).max(10000).optional(),
    size: z.number().int().min(1).max(100).optional(),
  }),
  'registry:details': z.object({ name: packageName }),
  'packages:inspect': z.object({ name: packageName, version }),
  'packages:discard': z.object({ stagingId: id }),
  'install:plan': z.object({
    stagingId: id,
    skills: z.array(z.string().min(1).max(64)).min(1).max(100),
    targets: z
      .array(
        z.object({
          agentId: z.enum(AGENT_IDS),
          scope: z.enum(['global', 'project']),
          rootId: z.string().min(1).max(4200).optional(),
        }),
      )
      .min(1)
      .max(12),
    allowSharedInstall: z.boolean(),
  }),
  'install:execute': z.object({
    planId: id,
    conflictPolicy: z.enum(['abort', 'replace']),
    confirmed: z.boolean(),
  }),
  'receipts:list': z.undefined(),
  'operations:list': z.object({ limit: z.number().int().min(1).max(1000).optional() }).optional(),
  'updates:check': z.undefined(),
  'updates:preview': z.object({ receiptId: id, version: version.optional() }),
  'updates:apply': z.object({
    receiptId: id,
    stagingId: id,
    confirmed: z.boolean(),
    overwriteModified: z.boolean(),
  }),
  'removal:preview': z.object({ receiptId: id }),
  'removal:execute': z.object({ receiptId: id, removeModified: z.boolean(), confirmed: z.boolean() }),
  'backups:restore': z.object({ receiptId: id, confirmed: z.boolean() }),
  'settings:get': z.undefined(),
  'settings:update': settingsPatchSchema,
  'dialog:select-directory': z.object({ title: z.string().max(200).optional() }).optional(),
  'export:inventory': z.object({ format: z.enum(['json', 'csv', 'markdown']) }),
} as const;

export type IpcChannel = keyof typeof ipcSchemas;

export type IpcPayload<C extends IpcChannel> = z.infer<(typeof ipcSchemas)[C]>;

export const IPC_CHANNELS = Object.keys(ipcSchemas) as IpcChannel[];

export const IPC_EVENT_PROGRESS = 'event:progress';
export const IPC_EVENT_INVENTORY_UPDATED = 'event:inventory-updated';

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ipcSchemas, value);
}

export type PayloadCheck<C extends IpcChannel> =
  | { ok: true; value: IpcPayload<C> }
  | { ok: false; message: string };

export function validateIpcPayload<C extends IpcChannel>(channel: C, payload: unknown): PayloadCheck<C> {
  const schema: z.ZodType = ipcSchemas[channel];
  const parsed = schema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data as IpcPayload<C> };
  return {
    ok: false,
    message: parsed.error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; '),
  };
}
