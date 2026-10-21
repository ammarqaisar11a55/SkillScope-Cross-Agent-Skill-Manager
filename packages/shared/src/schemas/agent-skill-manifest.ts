import { z } from 'zod';
import { AGENT_IDS } from '../types/agents.js';

/**
 * `agent-skill.json` — a SkillScope-owned package convention (not an npm or agent standard).
 * See docs/npm-skill-packages.md for the full contract.
 */
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS = [1] as const;

export const MANIFEST_FILE_NAME = 'agent-skill.json';

/** Agent Skills naming rule: 1–64 chars, lowercase alphanumerics and single hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

const relativePackagePath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.startsWith('\\'), {
    message: 'must be a relative path',
  })
  .refine((p) => !p.includes('\\'), { message: 'must use forward slashes' })
  .transform((p) => p.replace(/^\.\//, '').replace(/\/$/, ''))
  .pipe(
    z
      .string()
      .min(1, 'must not be empty')
      .refine((p) => !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.'), {
        message: 'must not contain empty, "." or ".." segments',
      }),
  );

export const manifestSkillSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(SKILL_NAME_MAX_LENGTH)
    .regex(SKILL_NAME_PATTERN, 'must contain only lowercase letters, digits and single hyphens'),
  path: relativePackagePath,
  agents: z.array(z.enum(AGENT_IDS)).min(1, 'must list at least one agent'),
  description: z.string().max(SKILL_DESCRIPTION_MAX_LENGTH).optional(),
});

export const agentSkillManifestSchema = z
  .object({
    schemaVersion: z.literal(SUPPORTED_MANIFEST_SCHEMA_VERSIONS),
    skills: z.array(manifestSkillSchema).min(1, 'must declare at least one skill').max(100),
    homepage: z.string().url().optional(),
  })
  .superRefine((manifest, ctx) => {
    const names = new Set<string>();
    const paths = new Set<string>();
    manifest.skills.forEach((skill, index) => {
      if (names.has(skill.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['skills', index, 'name'],
          message: `duplicate skill name "${skill.name}"`,
        });
      }
      names.add(skill.name);
      const key = skill.path.toLowerCase();
      if (paths.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['skills', index, 'path'],
          message: `duplicate skill path "${skill.path}"`,
        });
      }
      paths.add(key);
    });
    // Reject nested declarations: one skill directory inside another is ambiguous.
    const sorted = [...manifest.skills].map((s) => s.path.toLowerCase()).sort();
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1] as string;
      const cur = sorted[i] as string;
      if (cur.startsWith(`${prev}/`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['skills'],
          message: `skill path "${cur}" is nested inside "${prev}"`,
        });
      }
    }
  });

export type AgentSkillManifest = z.infer<typeof agentSkillManifestSchema>;
export type ManifestSkill = z.infer<typeof manifestSkillSchema>;

export interface ManifestParseResult {
  manifest: AgentSkillManifest | null;
  errors: string[];
}

export function parseAgentSkillManifest(raw: string): ManifestParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return {
      manifest: null,
      errors: [`agent-skill.json is not valid JSON: ${(error as Error).message}`],
    };
  }
  if (typeof data === 'object' && data !== null && 'schemaVersion' in data) {
    const version = (data as { schemaVersion: unknown }).schemaVersion;
    if (
      typeof version === 'number' &&
      !(SUPPORTED_MANIFEST_SCHEMA_VERSIONS as readonly number[]).includes(version)
    ) {
      return {
        manifest: null,
        errors: [
          `schemaVersion ${version} is not supported (supported: ${SUPPORTED_MANIFEST_SCHEMA_VERSIONS.join(', ')}). Update SkillScope.`,
        ],
      };
    }
  }
  const parsed = agentSkillManifestSchema.safeParse(data);
  if (!parsed.success) {
    return {
      manifest: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { manifest: parsed.data, errors: [] };
}
