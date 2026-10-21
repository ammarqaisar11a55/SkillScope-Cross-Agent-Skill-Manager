import type { PackageInspection, ValidationIssue } from '@skillscope/shared';
import { SkillScopeError } from '@skillscope/shared';
import type { AdapterRegistry } from '../agents/registry.js';
import type { PlatformContext } from '../platform/context.js';
import { inspectStagedSkills, lifecycleScripts, resolveLayout } from './inspect.js';
import { verifyIntegrity } from './integrity.js';
import { validatePackageName, validateVersion } from './names.js';
import type { NpmRegistryClient } from './registry.js';
import { stageFiles } from './staging.js';
import { readTarball } from './tarball.js';

export interface StagedPackage {
  inspection: PackageInspection;
  /** Absolute path of the staged package root. */
  dir: string;
}

export interface AcquireOptions {
  ctx: PlatformContext;
  dataDir: string;
  client: NpmRegistryClient;
  registry: AdapterRegistry;
  onStep?: (step: string, completed: number, total: number) => void;
}

const TOTAL_STEPS = 6;

/**
 * The secure acquisition pipeline: metadata → download → integrity → archive inspection →
 * staging → validation. Never runs package scripts or installs dependencies.
 */
export async function acquirePackage(
  name: string,
  version: string,
  options: AcquireOptions,
): Promise<StagedPackage> {
  const step = options.onStep ?? (() => undefined);
  validatePackageName(name);
  validateVersion(version);

  step('Reading package metadata', 1, TOTAL_STEPS);
  const meta = await options.client.version(name, version);
  const tarballUrl = meta.dist?.tarball;
  if (!tarballUrl)
    throw new SkillScopeError(
      'REGISTRY_ERROR',
      'The registry did not list a download for this version.',
    );

  step('Downloading package archive', 2, TOTAL_STEPS);
  const archive = await options.client.tarball(tarballUrl);

  step('Verifying integrity', 3, TOTAL_STEPS);
  const integrity = verifyIntegrity(archive, meta.dist ?? {});
  if (integrity.algorithm !== 'none' && !integrity.verified) {
    throw new SkillScopeError(
      'INTEGRITY_MISMATCH',
      `The downloaded archive does not match the registry's ${integrity.algorithm} checksum.`,
      {
        hint: 'The download may be corrupted or tampered with. Nothing was installed. Try again later.',
        details: [`expected ${integrity.expected}`, `actual ${integrity.actual}`],
      },
    );
  }

  step('Inspecting archive', 4, TOTAL_STEPS);
  const files = await readTarball(archive);

  step('Staging files in a temporary folder', 5, TOTAL_STEPS);
  const { stagingId, dir } = await stageFiles(options.ctx, options.dataDir, files);

  step('Validating skills', 6, TOTAL_STEPS);
  const layout = resolveLayout(files);
  const skills = await inspectStagedSkills(options.ctx, options.registry, dir, layout);
  const scripts = lifecycleScripts(files);
  const issues: ValidationIssue[] = [...layout.issues];
  if (integrity.algorithm === 'none') {
    issues.push({
      code: 'package.integrity-missing',
      severity: 'error',
      category: 'security',
      message:
        'The registry provides no checksum for this version, so its integrity cannot be verified.',
      hint: 'Choose a version with integrity metadata.',
    });
  } else if (integrity.algorithm === 'sha1') {
    issues.push({
      code: 'package.integrity-weak',
      severity: 'warning',
      category: 'security',
      message: 'Only a legacy SHA-1 checksum is available for this version.',
      hint: 'Prefer a newer version published with SHA-512 integrity.',
    });
  }
  if (scripts.length > 0) {
    issues.push({
      code: 'package.lifecycle-scripts',
      severity: 'info',
      category: 'security',
      message: `The package declares lifecycle scripts (${scripts.join(', ')}). SkillScope never runs them.`,
      hint: 'No action needed; only the skill files are copied.',
    });
  }
  const installable =
    integrity.verified &&
    !issues.some((i) => i.severity === 'error') &&
    skills.some((s) => s.validation.state !== 'invalid');

  return {
    dir,
    inspection: {
      stagingId,
      name,
      version,
      tarballUrl,
      integrity,
      manifestSource: layout.source,
      schemaVersion: layout.schemaVersion,
      skills,
      files: files.map((f) => f.path).sort(),
      totalBytes: files.reduce((n, f) => n + f.data.length, 0),
      lifecycleScripts: scripts,
      issues,
      installable,
    },
  };
}
