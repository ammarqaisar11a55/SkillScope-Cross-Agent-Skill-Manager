import { describe, expect, it } from 'vitest';
import {
  NpmRegistryClient,
  agentHintsFromKeywords,
  registryPath,
  validatePackageName,
  validateVersion,
} from '../src/index.js';
import { REGISTRY, mockRegistry, tarFixture } from './package-helpers.js';

function client(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof NpmRegistryClient>[0]> = {},
) {
  return new NpmRegistryClient({
    url: REGISTRY,
    timeoutMs: 1000,
    retries: 2,
    fetch: fetchImpl,
    sleep: async () => undefined,
    ...extra,
  });
}

describe('package names', () => {
  it('accepts scoped and unscoped names', () => {
    expect(validatePackageName('@acme/agent-skills')).toEqual({
      scope: 'acme',
      name: 'agent-skills',
    });
    expect(validatePackageName('skill-pack')).toEqual({ scope: null, name: 'skill-pack' });
    expect(registryPath('@acme/agent-skills')).toBe('@acme%2Fagent-skills');
  });

  it.each([
    '',
    'UPPER',
    '../etc',
    '@scope',
    '@/x',
    'a b',
    '.hidden',
    'node_modules',
    'x'.repeat(215),
  ])('rejects %j', (n) => {
    expect(() => validatePackageName(n)).toThrow();
  });

  it('validates versions', () => {
    expect(validateVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(() => validateVersion('latest')).toThrow();
    expect(() => validateVersion('1.0.0/../../x')).toThrow();
  });
});

describe('NpmRegistryClient', () => {
  it('searches with skill keywords and maps results', async () => {
    const reg = mockRegistry({
      '@acme/agent-skills': {
        versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } },
        keywords: ['agent-skill', 'claude-code-skill', 'cursor-skill'],
      },
    });
    const page = await client(reg.fetch).search({ text: 'review', agents: ['claude'] });
    const url = new URL(reg.requests[0] as string);
    expect(url.searchParams.get('text')).toBe('review keywords:claude-code-skill');
    expect(page.results[0]).toMatchObject({
      name: '@acme/agent-skills',
      agentHints: ['claude', 'cursor'],
      publisher: 'acme',
    });

    await client(reg.fetch).search({ text: '' });
    expect(new URL(reg.requests[1] as string).searchParams.get('text')).toBe(
      'keywords:agent-skill,claude-code-skill,codex-skill,cursor-skill',
    );
  });

  it('derives agent hints from keywords only', () => {
    expect(agentHintsFromKeywords(['codex-skill', 'CURSOR-SKILL', 'agent-skill'])).toEqual([
      'codex',
      'cursor',
    ]);
  });

  it('returns package details with versions and repository', async () => {
    const tgz = await tarFixture('multi-skill');
    const reg = mockRegistry({
      '@acme/agent-skills': { versions: { '1.0.0': { tarball: tgz }, '1.1.0': { tarball: tgz } } },
    });
    const details = await client(reg.fetch).details('@acme/agent-skills');
    expect(details.distTags.latest).toBe('1.1.0');
    expect(details.versions.map((v) => v.version)).toEqual(['1.1.0', '1.0.0']);
    expect(details.repository).toBe('https://github.com/acme/skills');
    expect(new URL(reg.requests[0] as string).pathname).toBe('/@acme%2Fagent-skills');
  });

  it('maps 404 to PACKAGE_NOT_FOUND', async () => {
    const reg = mockRegistry({});
    await expect(client(reg.fetch).details('missing-pkg')).rejects.toMatchObject({
      code: 'PACKAGE_NOT_FOUND',
    });
  });

  it('retries server errors, then succeeds', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls < 3) return new Response('boom', { status: 503 });
      return new Response(JSON.stringify({ total: 0, objects: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(client(flaky).search({ text: 'x' })).resolves.toEqual({ total: 0, results: [] });
    expect(calls).toBe(3);
  });

  it('gives up after the configured retries', async () => {
    let calls = 0;
    const down = (async () => {
      calls += 1;
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    await expect(client(down, { retries: 1 }).search({ text: 'x' })).rejects.toMatchObject({
      code: 'REGISTRY_ERROR',
    });
    expect(calls).toBe(2);
  });

  it('times out slow requests', async () => {
    const slow = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as unknown as typeof fetch;
    await expect(
      client(slow, { timeoutMs: 20, retries: 0 }).search({ text: 'x' }),
    ).rejects.toMatchObject({ code: 'REGISTRY_TIMEOUT' });
  });

  it('maps network failures without leaking credentials', async () => {
    const broken = (async () => {
      throw new Error('connect ECONNREFUSED https://user:secret@proxy');
    }) as unknown as typeof fetch;
    const error = await client(broken, { retries: 0 })
      .search({ text: 'x' })
      .catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
    expect((error as Error).message).not.toContain('secret');
  });

  it('refuses to work offline', async () => {
    const reg = mockRegistry({});
    await expect(client(reg.fetch, { offline: true }).search({ text: 'x' })).rejects.toMatchObject({
      code: 'NETWORK_DISABLED',
    });
    expect(reg.requests).toEqual([]);
  });

  it('refuses insecure or credentialed tarball URLs', () => {
    const c = client(mockRegistry({}).fetch);
    expect(() => c.checkTarballUrl('http://evil.example.com/x.tgz')).toThrow();
    expect(() => c.checkTarballUrl('https://u:p@registry.test.invalid/x.tgz')).toThrow();
    expect(c.checkTarballUrl('https://registry.test.invalid/x.tgz').href).toContain('x.tgz');
    const local = new NpmRegistryClient({
      url: 'http://localhost:4873',
      timeoutMs: 1000,
      retries: 0,
    });
    expect(local.checkTarballUrl('http://localhost:4873/x.tgz').protocol).toBe('http:');
  });

  it('refuses registry URLs with credentials', () => {
    expect(
      () =>
        new NpmRegistryClient({
          url: 'https://u:p@registry.example.com',
          timeoutMs: 1000,
          retries: 0,
        }),
    ).toThrow();
  });

  it('enforces the tarball size limit while streaming', async () => {
    const big = (async () =>
      new Response(new Uint8Array(2048), { status: 200 })) as unknown as typeof fetch;
    await expect(client(big).tarball(`${REGISTRY}/x.tgz`, 1024)).rejects.toMatchObject({
      code: 'UNSAFE_ARCHIVE',
    });
  });
});
