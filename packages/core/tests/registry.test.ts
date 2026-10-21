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
  it('searches one keyword at a time and maps results', async () => {
    const reg = mockRegistry({
      '@acme/agent-skills': {
        versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } },
        keywords: ['agent-skill', 'claude-code-skill', 'cursor-skill'],
        description: 'Code review and test writing skills',
      },
    });
    const page = await client(reg.fetch).search({ text: 'review', agents: ['claude'] });
    expect(reg.requests.map((r) => new URL(r).searchParams.get('text'))).toEqual([
      'review keywords:claude-code-skill',
    ]);
    expect(page.results[0]).toMatchObject({
      name: '@acme/agent-skills',
      agentHints: ['claude', 'cursor'],
      publisher: 'acme',
    });
  });

  it('treats several agents as "any of" and de-duplicates the merged results', async () => {
    const tgz = await tarFixture('multi-skill');
    const reg = mockRegistry({
      'claude-only': { versions: { '1.0.0': { tarball: tgz } }, keywords: ['claude-code-skill'] },
      'cursor-only': { versions: { '1.0.0': { tarball: tgz } }, keywords: ['cursor-skill'] },
      both: {
        versions: { '1.0.0': { tarball: tgz } },
        keywords: ['claude-code-skill', 'cursor-skill'],
      },
      'codex-only': { versions: { '1.0.0': { tarball: tgz } }, keywords: ['codex-skill'] },
    });
    const page = await client(reg.fetch).search({ text: '', agents: ['claude', 'cursor'] });
    expect(page.results.map((r) => r.name).sort()).toEqual(['both', 'claude-only', 'cursor-only']);
    expect(reg.requests.map((r) => new URL(r).searchParams.get('text'))).toEqual([
      'keywords:claude-code-skill',
      'keywords:cursor-skill',
    ]);
  });

  it('searches every skill keyword when no agent is selected', async () => {
    const reg = mockRegistry({});
    await client(reg.fetch).search({ text: '' });
    expect(reg.requests.map((r) => new URL(r).searchParams.get('text'))).toEqual([
      'keywords:agent-skill',
      'keywords:claude-code-skill',
      'keywords:codex-skill',
      'keywords:cursor-skill',
    ]);
  });

  it("keeps every request within npm's 64-character text limit", async () => {
    // Regression: "front" plus all four keywords was 69 characters and npm answered HTTP 400.
    const reg = mockRegistry({
      'frontend-skill': {
        versions: { '1.0.0': { tarball: await tarFixture('multi-skill') } },
        keywords: ['agent-skill', 'cursor-skill'],
        description: 'Frontend review helpers',
      },
    });
    const page = await client(reg.fetch).search({ text: 'front' });
    expect(page.results.map((r) => r.name)).toEqual(['frontend-skill']);
    const long = await client(reg.fetch).search({ text: 'x'.repeat(200) });
    expect(long.results).toEqual([]);
    for (const r of reg.requests) {
      expect((new URL(r).searchParams.get('text') ?? '').length).toBeLessThanOrEqual(64);
    }
  });

  it('filters results by the typed text because npm only uses it for ranking', async () => {
    const tgz = await tarFixture('multi-skill');
    const reg = mockRegistry({
      'pdf-tools': { versions: { '1.0.0': { tarball: tgz } }, description: 'Work with PDF files' },
      'yaml-helper': { versions: { '1.0.0': { tarball: tgz } }, description: 'YAML utilities' },
    });
    const page = await client(reg.fetch).search({ text: 'PDF files' });
    expect(page.results.map((r) => r.name)).toEqual(['pdf-tools']);
  });

  it("shows the registry's reason when it rejects a request", async () => {
    const reject = (async () =>
      new Response(JSON.stringify({ error: 'The text parameter is invalid' }), {
        status: 400,
      })) as unknown as typeof fetch;
    const error = await client(reject)
      .search({ text: 'x' })
      .catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'REGISTRY_ERROR' });
    expect((error as Error).message).toContain('The text parameter is invalid');
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
    await expect(client(flaky).search({ text: 'x', agents: ['claude'] })).resolves.toEqual({
      total: 0,
      results: [],
    });
    expect(calls).toBe(3);
  });

  it('gives up after the configured retries', async () => {
    let calls = 0;
    const down = (async () => {
      calls += 1;
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    await expect(
      client(down, { retries: 1 }).search({ text: 'x', agents: ['claude'] }),
    ).rejects.toMatchObject({
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
