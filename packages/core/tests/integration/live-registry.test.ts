import { describe, expect, it } from 'vitest';
import { NpmRegistryClient, readTarball, resolveLayout, verifyIntegrity } from '../../src/index.js';

// Talks to the real public registry. Excluded from `npm test`; run with `npm run test:integration`.
const client = new NpmRegistryClient({
  url: 'https://registry.npmjs.org',
  timeoutMs: 20_000,
  retries: 1,
});

describe('live npm registry', () => {
  it('searches by skill keywords', async () => {
    const page = await client.search({ text: '', size: 5 });
    expect(page.total).toBeGreaterThanOrEqual(0);
    for (const r of page.results) expect(typeof r.name).toBe('string');
  });

  it('reads metadata for a scoped package', async () => {
    const details = await client.details('@types/node');
    expect(details.name).toBe('@types/node');
    expect(details.versions.length).toBeGreaterThan(10);
  });

  it('downloads, verifies and classifies a real non-skill package', async () => {
    const meta = await client.version('is-number', '7.0.0');
    const archive = await client.tarball(meta.dist?.tarball ?? '');
    const integrity = verifyIntegrity(archive, meta.dist ?? {});
    expect(integrity).toMatchObject({ algorithm: 'sha512', verified: true });
    const files = await readTarball(archive);
    expect(files.map((f) => f.path)).toContain('package.json');
    expect(resolveLayout(files).issues.map((i) => i.code)).toContain('package.not-a-skill-package');
  });

  it('reports a missing package clearly', async () => {
    await expect(
      client.details('skillscope-this-package-should-not-exist-0001'),
    ).rejects.toMatchObject({
      code: 'PACKAGE_NOT_FOUND',
    });
  });
});
