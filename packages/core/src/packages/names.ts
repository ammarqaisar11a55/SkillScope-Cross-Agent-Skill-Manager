import { SkillScopeError } from '@skillscope/shared';

const NAME = /^(?:@([a-z0-9][a-z0-9._~-]*)\/)?([a-z0-9][a-z0-9._~-]*)$/;

/** npm's naming rules for new packages, applied to any name we send to the registry. */
export function validatePackageName(name: string): { scope: string | null; name: string } {
  if (name.length === 0 || name.length > 214) {
    throw new SkillScopeError(
      'INVALID_PACKAGE_NAME',
      'Package names must be 1–214 characters long.',
    );
  }
  const match = NAME.exec(name);
  if (!match) {
    throw new SkillScopeError(
      'INVALID_PACKAGE_NAME',
      `"${name}" is not a valid npm package name.`,
      {
        hint: 'Use lowercase letters, digits, "-", "." and "_", optionally with an @scope/ prefix.',
      },
    );
  }
  const bare = match[2] as string;
  if (bare === 'node_modules' || bare === 'favicon.ico') {
    throw new SkillScopeError('INVALID_PACKAGE_NAME', `"${name}" is a reserved package name.`);
  }
  return { scope: match[1] ?? null, name: bare };
}

/** Path segment for registry metadata requests: scoped names keep "@" and encode "/". */
export function registryPath(name: string): string {
  validatePackageName(name);
  return name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateVersion(version: string): string {
  if (version.length > 256 || !VERSION.test(version)) {
    throw new SkillScopeError('INVALID_REQUEST', `"${version}" is not a valid semantic version.`);
  }
  return version;
}
