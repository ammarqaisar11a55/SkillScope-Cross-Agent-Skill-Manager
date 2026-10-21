import { createHash, timingSafeEqual } from 'node:crypto';
import type { IntegrityResult } from '@skillscope/shared';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify downloaded bytes against registry metadata. Prefers the SRI sha512 `integrity` field;
 * falls back to the legacy sha1 `shasum`. Missing metadata yields verified = false.
 */
export function verifyIntegrity(
  data: Uint8Array,
  dist: { integrity?: string; shasum?: string },
): IntegrityResult {
  const sri = (dist.integrity ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sha512 = sri.filter((s) => s.startsWith('sha512-'));
  if (sha512.length > 0) {
    const actual = `sha512-${createHash('sha512').update(data).digest('base64')}`;
    const verified = sha512.some((expected) => safeEqual(expected.replace(/\?.*$/, ''), actual));
    return { algorithm: 'sha512', expected: sha512[0] ?? null, actual, verified };
  }
  if (dist.shasum && /^[0-9a-f]{40}$/i.test(dist.shasum)) {
    const actual = createHash('sha1').update(data).digest('hex');
    return {
      algorithm: 'sha1',
      expected: dist.shasum.toLowerCase(),
      actual,
      verified: safeEqual(dist.shasum.toLowerCase(), actual),
    };
  }
  return {
    algorithm: 'none',
    expected: null,
    actual: `sha512-${createHash('sha512').update(data).digest('base64')}`,
    verified: false,
  };
}
