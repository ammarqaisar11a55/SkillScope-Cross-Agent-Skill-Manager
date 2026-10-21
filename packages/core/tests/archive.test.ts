import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readTarball, sanitizeArchivePath, verifyIntegrity } from '../src/index.js';
import { buildTarball, sri, shasum, type TarEntry } from './package-helpers.js';

const ok: TarEntry = { name: 'package/package.json', content: '{"name":"x","version":"1.0.0"}' };

describe('integrity verification', () => {
  const data = Buffer.from('hello');
  it('verifies sha512 SRI', () => {
    expect(verifyIntegrity(data, { integrity: sri(data) })).toMatchObject({
      algorithm: 'sha512',
      verified: true,
    });
  });
  it('detects a hash mismatch', () => {
    expect(verifyIntegrity(data, { integrity: sri(Buffer.from('other')) })).toMatchObject({
      verified: false,
    });
  });
  it('accepts any of several SRI hashes and ignores weaker algorithms when sha512 exists', () => {
    expect(
      verifyIntegrity(data, { integrity: `sha1-abc ${sri(Buffer.from('x'))} ${sri(data)}` })
        .verified,
    ).toBe(true);
  });
  it('falls back to sha1 shasum', () => {
    expect(verifyIntegrity(data, { shasum: shasum(data) })).toMatchObject({
      algorithm: 'sha1',
      verified: true,
    });
    expect(verifyIntegrity(data, { shasum: shasum(Buffer.from('x')) }).verified).toBe(false);
  });
  it('reports missing metadata as unverified', () => {
    expect(verifyIntegrity(data, {})).toMatchObject({ algorithm: 'none', verified: false });
  });
});

describe('archive path sanitisation', () => {
  it('strips the package/ prefix', () => {
    expect(sanitizeArchivePath('package/skills/a/SKILL.md')).toBe('skills/a/SKILL.md');
    expect(sanitizeArchivePath('package/')).toBeNull();
  });
  it.each([
    '/etc/passwd',
    'C:/Windows/x',
    'package/../../evil',
    'package/skills/../../../evil',
    'package\\..\\evil',
    'package/con.txt',
    'package/a:b',
    'package/trailing.',
    'package/nul\u0000byte',
  ])('rejects %j', (p) => {
    expect(() => sanitizeArchivePath(p)).toThrow(/Unsafe package archive/);
  });
});

describe('tarball reader', () => {
  it('reads regular files and records executables', async () => {
    const files = await readTarball(
      await buildTarball([
        ok,
        { name: 'package/scripts/run.sh', content: '#!/bin/sh', mode: 0o755 },
        { name: 'package/dir', type: 'directory' },
      ]),
    );
    expect(files.map((f) => f.path)).toEqual(['package.json', 'scripts/run.sh']);
    expect(files[1]?.executable).toBe(true);
  });

  it.each<[string, TarEntry]>([
    ['symlink', { name: 'package/link', type: 'symlink', linkname: '/etc/passwd' }],
    [
      'relative symlink escape',
      { name: 'package/skills/a/x', type: 'symlink', linkname: '../../../../.ssh/id_rsa' },
    ],
    ['hard link', { name: 'package/hard', type: 'link', linkname: 'package/package.json' }],
    ['character device', { name: 'package/dev', type: 'character-device' }],
    ['fifo', { name: 'package/pipe', type: 'fifo' }],
    ['path traversal', { name: 'package/../../escape.txt', content: 'x' }],
    ['absolute path', { name: '/tmp/escape.txt', content: 'x' }],
    ['top-level file', { name: 'escape.txt', content: 'x' }],
  ])('rejects a %s entry', async (_label, bad) => {
    await expect(readTarball(await buildTarball([ok, bad]))).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
  });

  it('rejects duplicate entries that differ only by case', async () => {
    await expect(
      readTarball(
        await buildTarball([
          ok,
          { name: 'package/A.md', content: '1' },
          { name: 'package/a.md', content: '2' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('rejects a file that is also used as a directory', async () => {
    await expect(
      readTarball(
        await buildTarball([
          ok,
          { name: 'package/a', content: '1' },
          { name: 'package/a/b', content: '2' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('rejects data that is not gzip or not tar', async () => {
    await expect(readTarball(Buffer.from('not gzip'))).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
    await expect(
      readTarball(gzipSync(Buffer.from('not a tar archive'.repeat(100)))),
    ).rejects.toMatchObject({ code: 'UNSAFE_ARCHIVE' });
  });

  it('rejects archives that expand beyond the size limit', async () => {
    const huge = Buffer.alloc(21 * 1024 * 1024, 0);
    await expect(
      readTarball(await buildTarball([ok, { name: 'package/big.bin', content: huge }])),
    ).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
  });
});
