import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
import { FIXTURES } from './helpers.js';

export interface TarEntry {
  name: string;
  content?: string | Buffer;
  type?: 'file' | 'directory' | 'symlink' | 'link' | 'character-device' | 'fifo';
  linkname?: string;
  mode?: number;
}

/** Build a gzipped tarball in memory, including deliberately malicious entries for tests. */
export async function buildTarball(entries: TarEntry[]): Promise<Buffer> {
  const p = pack();
  const chunks: Buffer[] = [];
  p.on('data', (c: unknown) => chunks.push(c as Buffer));
  const finished = new Promise<void>((resolve, reject) => {
    p.on('end', () => resolve());
    p.on('error', reject);
  });
  for (const e of entries) {
    const type = e.type ?? 'file';
    if (type === 'file') {
      const body =
        typeof e.content === 'string' ? Buffer.from(e.content) : (e.content ?? Buffer.alloc(0));
      p.entry({ name: e.name, size: body.length, mode: e.mode ?? 0o644 }, body);
    } else {
      p.entry({ name: e.name, type, linkname: e.linkname, mode: e.mode ?? 0o755 });
    }
  }
  p.finalize();
  await finished;
  return gzipSync(Buffer.concat(chunks));
}

async function walk(dir: string, prefix = ''): Promise<TarEntry[]> {
  const out: TarEntry[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(join(dir, e.name), rel)));
    else out.push({ name: `package/${rel}`, content: await readFile(join(dir, e.name)) });
  }
  return out;
}

/** Tar a fixture package directory the way `npm pack` does (everything under "package/"). */
export async function tarFixture(name: string, overrides: TarEntry[] = []): Promise<Buffer> {
  const entries = await walk(join(FIXTURES, 'packages', name));
  for (const o of overrides) {
    const i = entries.findIndex((e) => e.name === o.name);
    if (i >= 0) entries[i] = o;
    else entries.push(o);
  }
  return buildTarball(entries);
}

export function sri(buf: Uint8Array): string {
  return `sha512-${createHash('sha512').update(buf).digest('base64')}`;
}

export function shasum(buf: Uint8Array): string {
  return createHash('sha1').update(buf).digest('hex');
}

export interface MockVersion {
  tarball: Buffer;
  integrity?: string | null;
  shasum?: string | null;
  scripts?: Record<string, string>;
}

export interface MockPackage {
  versions: Record<string, MockVersion>;
  latest?: string;
  keywords?: string[];
  description?: string;
}

export const REGISTRY = 'https://registry.test.invalid';

/**
 * A deterministic stand-in for the npm registry. Records every request so tests can assert that
 * nothing unexpected (such as a lifecycle script runner) was contacted.
 */
export function mockRegistry(packages: Record<string, MockPackage>, base: string = REGISTRY) {
  const requests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    requests.push(url.href);
    if (url.pathname === '/-/v1/search') {
      const text = url.searchParams.get('text') ?? '';
      // Mirror the real registry: 2-64 characters, comma-separated keywords are ANDed, and free
      // text only affects ranking, never which packages match.
      if (text.length < 2 || text.length > 64) {
        return new Response(
          JSON.stringify({
            error: "The 'text' parameter must be between 2 and 64 characters",
            code: 'ERR_TEXT_LENGTH',
          }),
          { status: 400 },
        );
      }
      const required = /keywords:(\S+)/.exec(text)?.[1]?.split(',') ?? [];
      const objects = Object.entries(packages)
        .filter(([, p]) => required.every((k) => (p.keywords ?? ['agent-skill']).includes(k)))
        .map(([name, p], i) => ({
          searchScore: 100 - i,
          package: {
            name,
            version: p.latest ?? Object.keys(p.versions).at(-1),
            description: p.description ?? `${name} description`,
            keywords: p.keywords ?? ['agent-skill'],
            date: '2026-10-01T00:00:00.000Z',
            publisher: { username: 'acme' },
            maintainers: [{ username: 'acme' }],
            links: {
              npm: `https://www.npmjs.com/package/${name}`,
              repository: 'https://github.com/acme/skills',
            },
          },
        }));
      return new Response(JSON.stringify({ total: objects.length, objects }), { status: 200 });
    }
    const tar = /^\/-\/tarball\/(.+)\/(.+)\.tgz$/.exec(url.pathname);
    if (tar) {
      const name = decodeURIComponent(tar[1] as string);
      const v = packages[name]?.versions[tar[2] as string];
      return v
        ? new Response(new Uint8Array(v.tarball), { status: 200 })
        : new Response('not found', { status: 404 });
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    const p = packages[name];
    if (!p) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const versions = Object.fromEntries(
      Object.entries(p.versions).map(([version, v]) => [
        version,
        {
          name,
          version,
          scripts: v.scripts ?? {},
          dist: {
            tarball: `${base}/-/tarball/${encodeURIComponent(name)}/${version}.tgz`,
            ...(v.integrity === null ? {} : { integrity: v.integrity ?? sri(v.tarball) }),
            ...(v.shasum === null || v.shasum === undefined ? {} : { shasum: v.shasum }),
          },
        },
      ]),
    );
    return new Response(
      JSON.stringify({
        name,
        description: p.description ?? `${name} description`,
        'dist-tags': { latest: p.latest ?? Object.keys(p.versions).at(-1) },
        versions,
        time: Object.fromEntries(
          Object.keys(p.versions).map((v, i) => [v, `2026-0${(i % 9) + 1}-01T00:00:00.000Z`]),
        ),
        maintainers: [{ name: 'acme' }],
        repository: { url: 'git+https://github.com/acme/skills.git' },
        license: 'MIT',
        keywords: p.keywords ?? ['agent-skill'],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}
