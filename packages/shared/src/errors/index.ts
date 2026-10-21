export const ERROR_CODES = [
  'INVALID_REQUEST',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'FILE_LOCKED',
  'PATH_TOO_LONG',
  'PATH_OUTSIDE_ROOT',
  'TARGET_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'NETWORK_DISABLED',
  'NETWORK_ERROR',
  'REGISTRY_TIMEOUT',
  'REGISTRY_ERROR',
  'INVALID_PACKAGE_NAME',
  'PACKAGE_NOT_FOUND',
  'INTEGRITY_MISMATCH',
  'UNSAFE_ARCHIVE',
  'INVALID_MANIFEST',
  'NOT_A_SKILL_PACKAGE',
  'VALIDATION_FAILED',
  'INSTALL_FAILED',
  'ROLLBACK_FAILED',
  'MODIFIED_FILES',
  'UNSUPPORTED_AGENT',
  'IO_ERROR',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
  hint?: string;
  details?: string[];
}

export class SkillScopeError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly details: string[] | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { hint?: string; details?: string[]; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SkillScopeError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }

  toJSON(): SerializedError {
    return serialize(this.code, this.message, this.hint, this.details);
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: SerializedError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: SerializedError): Result<T> {
  return { ok: false, error };
}

function serialize(
  code: ErrorCode,
  message: string,
  hint?: string,
  details?: string[],
): SerializedError {
  const out: SerializedError = { code, message: redactSecrets(message) };
  if (hint) out.hint = hint;
  if (details && details.length > 0) out.details = details.map(redactSecrets);
  return out;
}

const ERRNO_MAP: Record<string, { code: ErrorCode; hint: string }> = {
  EACCES: {
    code: 'PERMISSION_DENIED',
    hint: 'Check that your user account can read and write this location. SkillScope never needs administrator rights for user-level skills.',
  },
  EPERM: {
    code: 'PERMISSION_DENIED',
    hint: 'The operating system refused the operation. On Windows, close programs that may be using the files and try again.',
  },
  EBUSY: {
    code: 'FILE_LOCKED',
    hint: 'A file is in use by another program (for example an editor or the agent). Close it and retry.',
  },
  ENOENT: {
    code: 'NOT_FOUND',
    hint: 'The path no longer exists. Rescan to refresh the inventory.',
  },
  ENAMETOOLONG: {
    code: 'PATH_TOO_LONG',
    hint: 'The path exceeds the platform limit. Choose a shorter installation location.',
  },
  ENOTEMPTY: {
    code: 'IO_ERROR',
    hint: 'The directory is not empty. Rescan and review its contents before retrying.',
  },
  EEXIST: {
    code: 'TARGET_CONFLICT',
    hint: 'Something already exists at the target. Review the conflict before replacing it.',
  },
  ENOSPC: {
    code: 'IO_ERROR',
    hint: 'The disk is full. Free some space and retry.',
  },
};

function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** Convert any thrown value into a safe, serialisable error with a useful hint. */
export function toSerializedError(error: unknown): SerializedError {
  if (error instanceof SkillScopeError) return error.toJSON();
  const errno = errnoCode(error);
  const message = error instanceof Error ? error.message : String(error);
  if (errno && ERRNO_MAP[errno]) {
    const mapped = ERRNO_MAP[errno];
    return serialize(mapped.code, message, mapped.hint);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return serialize(
      'REGISTRY_TIMEOUT',
      'The request timed out.',
      'Check your connection or increase the timeout in Settings.',
    );
  }
  return serialize(
    'INTERNAL',
    message,
    'This is unexpected. The operation log contains more detail.',
  );
}

const SECRET_PATTERNS: RegExp[] = [
  // npm tokens
  /npm_[A-Za-z0-9]{20,}/g,
  // Authorization headers
  /(authorization\s*[:=]\s*)(bearer|basic)\s+[^\s"']+/gi,
  // _authToken / _auth / password entries in npmrc-like strings
  /(_authToken|_auth|_password|password|token)(\s*[=:]\s*)[^\s"']+/gi,
  // Credentials embedded in URLs
  /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
];

/** Remove credentials from text before it is logged or shown in the UI. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0] as RegExp, '[REDACTED]');
  out = out.replace(SECRET_PATTERNS[1] as RegExp, '$1$2 [REDACTED]');
  out = out.replace(SECRET_PATTERNS[2] as RegExp, '$1$2[REDACTED]');
  out = out.replace(SECRET_PATTERNS[3] as RegExp, '$1[REDACTED]@');
  return out;
}
