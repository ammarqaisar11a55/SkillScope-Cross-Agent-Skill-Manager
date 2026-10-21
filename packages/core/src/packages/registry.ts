import type {
  AgentId,
  PackageDetails,
  PackageVersionSummary,
  RegistrySearchPage,
  RegistrySearchQuery,
  RegistrySearchResult,
} from '@skillscope/shared';
import { SkillScopeError, redactSecrets } from '@skillscope/shared';
import { registryPath, validatePackageName, validateVersion } from './names.js';

/** Search keywords. They help discovery but prove nothing about safety or compatibility. */
export const SKILL_KEYWORDS: Readonly<Record<'any' | AgentId, string>> = {
  any: 'agent-skill',
  claude: 'claude-code-skill',
  codex: 'codex-skill',
  cursor: 'cursor-skill',
};

export const MAX_TARBALL_BYTES = 50 * 1024 * 1024;

/** npm rejects search `text` longer than this (ERR_TEXT_LENGTH). */
export const MAX_SEARCH_TEXT_LENGTH = 64;

export interface RegistryClientOptions {
  url: string;
  timeoutMs: number;
  retries: number;
  fetch?: typeof fetch;
  /** When true every request fails fast with NETWORK_DISABLED. */
  offline?: boolean;
  /** Back-off between retries; overridable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Subset of the npm packument we rely on. Everything else is ignored. */
export interface PackumentVersion {
  name: string;
  version: string;
  description?: string;
  keywords?: unknown;
  scripts?: Record<string, unknown>;
  deprecated?: unknown;
  dist?: {
    tarball?: string;
    integrity?: string;
    shasum?: string;
    unpackedSize?: number;
    fileCount?: number;
  };
}

export interface Packument {
  name: string;
  description?: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
  time?: Record<string, string>;
  maintainers?: { name?: string; email?: string }[];
  repository?: string | { url?: string };
  homepage?: string;
  license?: string | { type?: string };
  keywords?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function agentHintsFromKeywords(keywords: string[]): AgentId[] {
  const set = new Set(keywords.map((k) => k.toLowerCase()));
  return (['claude', 'codex', 'cursor'] as const).filter((a) => set.has(SKILL_KEYWORDS[a]));
}

function repositoryUrl(repo: Packument['repository']): string | null {
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (!raw) return null;
  const cleaned = raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://');
  if (/^github:/.test(cleaned)) return `https://github.com/${cleaned.slice(7)}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(cleaned)) return `https://github.com/${cleaned}`;
  return /^https?:\/\//.test(cleaned) ? cleaned : null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class NpmRegistryClient {
  private readonly base: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: RegistryClientOptions) {
    let base: URL;
    try {
      base = new URL(options.url.endsWith('/') ? options.url : `${options.url}/`);
    } catch {
      throw new SkillScopeError('INVALID_REQUEST', 'The registry URL is invalid.');
    }
    if (base.username || base.password) {
      throw new SkillScopeError('INVALID_REQUEST', 'Registry URLs must not contain credentials.');
    }
    this.base = base;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
  }

  private isLocalRegistry(): boolean {
    return ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
  }

  /** Tarballs must be https, or plain http only when the registry itself is a local one. */
  checkTarballUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SkillScopeError('REGISTRY_ERROR', 'The registry returned an invalid tarball URL.');
    }
    if (url.username || url.password) {
      throw new SkillScopeError(
        'REGISTRY_ERROR',
        'Tarball URLs with embedded credentials are refused.',
      );
    }
    const ok =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && this.isLocalRegistry() && url.host === this.base.host);
    if (!ok)
      throw new SkillScopeError(
        'REGISTRY_ERROR',
        `Refusing to download from ${url.protocol}//${url.host}.`,
      );
    return url;
  }

  private async request(url: URL, accept: string): Promise<Response> {
    if (this.options.offline) {
      throw new SkillScopeError('NETWORK_DISABLED', 'Network access is turned off.', {
        hint: 'Enable "Allow network access" in Settings to use the Marketplace.',
      });
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      if (attempt > 0) await this.sleep(250 * 2 ** (attempt - 1));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          headers: {
            accept,
            'user-agent':
              'SkillScope (+https://github.com/ammarqaisar11a55/SkillScope-Cross-Agent-Skill-Manager)',
          },
          signal: controller.signal,
          redirect: 'follow',
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new SkillScopeError(
            'REGISTRY_ERROR',
            `The registry responded with HTTP ${res.status}.`,
          );
          continue;
        }
        return res;
      } catch (error) {
        lastError =
          (error as Error).name === 'AbortError'
            ? new SkillScopeError(
                'REGISTRY_TIMEOUT',
                `The registry did not respond within ${this.options.timeoutMs} ms.`,
                {
                  hint: 'Check your connection or increase the timeout in Settings.',
                },
              )
            : new SkillScopeError(
                'NETWORK_ERROR',
                `Could not reach the registry: ${redactSecrets((error as Error).message)}`,
                {
                  hint: 'Check your internet connection and the registry URL in Settings.',
                },
              );
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof SkillScopeError
      ? lastError
      : new SkillScopeError('NETWORK_ERROR', 'Request failed.');
  }

  private async json<T>(url: URL): Promise<T> {
    const res = await this.request(url, 'application/json');
    if (res.status === 404)
      throw new SkillScopeError('PACKAGE_NOT_FOUND', 'The package was not found in the registry.');
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === 'string') detail = `: ${redactSecrets(body.error).slice(0, 200)}`;
      } catch {
        // Not JSON; keep the status code only.
      }
      throw new SkillScopeError(
        'REGISTRY_ERROR',
        `The registry rejected the request (HTTP ${res.status})${detail}.`,
        { hint: res.status === 400 ? 'Try a shorter or simpler search.' : 'Try again later.' },
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new SkillScopeError('REGISTRY_ERROR', 'The registry returned malformed JSON.');
    }
  }

  /**
   * Search for skill packages. npm treats a comma in `keywords:` as AND and caps the whole `text`
   * parameter at 64 characters, so each keyword is searched separately (OR semantics) with the
   * user's text trimmed to fit, and the results are merged. npm only uses free text for ranking
   * within a keyword filter, so results are also filtered locally against the typed terms.
   */
  async search(query: RegistrySearchQuery): Promise<RegistrySearchPage> {
    const agents = query.agents ?? [];
    const keywords = agents.length
      ? agents.map((a) => SKILL_KEYWORDS[a])
      : Object.values(SKILL_KEYWORDS);
    const userText = query.text.trim().replace(/\s+/g, ' ');
    const size = query.size ?? 20;
    const pages = await Promise.all(
      keywords.map((keyword) => this.searchKeyword(userText, keyword, size, query.from ?? 0)),
    );

    const byName = new Map<string, { result: RegistrySearchResult; score: number }>();
    for (const page of pages) {
      for (const hit of page) {
        const existing = byName.get(hit.result.name);
        if (!existing || hit.score > existing.score) byName.set(hit.result.name, hit);
      }
    }
    const terms = userText.toLowerCase().split(' ').filter(Boolean);
    const matches = (r: RegistrySearchResult) => {
      const haystack = [r.name, r.description ?? '', ...r.keywords].join(' ').toLowerCase();
      return terms.every((t) => haystack.includes(t));
    };
    const results = [...byName.values()]
      .filter((h) => matches(h.result))
      .sort((a, b) => b.score - a.score || a.result.name.localeCompare(b.result.name))
      .map((h) => h.result)
      .slice(0, size);
    return { total: results.length, results };
  }

  private async searchKeyword(
    userText: string,
    keyword: string,
    size: number,
    from: number,
  ): Promise<{ result: RegistrySearchResult; score: number }[]> {
    const suffix = `keywords:${keyword}`;
    const budget = MAX_SEARCH_TEXT_LENGTH - suffix.length - 1;
    const text = userText ? `${userText.slice(0, budget).trim()} ${suffix}` : suffix;
    const url = new URL('-/v1/search', this.base);
    url.searchParams.set('text', text);
    // Ask for more than requested: npm ranks by text but does not filter by it.
    url.searchParams.set('size', String(Math.min(250, userText ? Math.max(size * 5, 100) : size)));
    url.searchParams.set('from', String(from));
    const body = await this.json<{
      objects?: {
        package?: Record<string, unknown>;
        searchScore?: unknown;
        score?: { final?: unknown };
      }[];
    }>(url);
    const out: { result: RegistrySearchResult; score: number }[] = [];
    for (const obj of body.objects ?? []) {
      const p = obj.package;
      if (!p || typeof p.name !== 'string' || typeof p.version !== 'string') continue;
      const kw = strings(p.keywords);
      const links = (p.links ?? {}) as Record<string, unknown>;
      const publisher = p.publisher as { username?: string } | undefined;
      const maintainers = Array.isArray(p.maintainers)
        ? (p.maintainers as { username?: string }[])
        : [];
      const score =
        typeof obj.searchScore === 'number'
          ? obj.searchScore
          : typeof obj.score?.final === 'number'
            ? obj.score.final
            : 0;
      out.push({
        score,
        result: {
          name: p.name,
          version: p.version,
          description: typeof p.description === 'string' ? p.description : null,
          keywords: kw,
          date: typeof p.date === 'string' ? p.date : null,
          publisher: publisher?.username ?? null,
          maintainers: maintainers
            .map((m) => m.username)
            .filter((m): m is string => typeof m === 'string'),
          links: {
            ...(typeof links.npm === 'string' ? { npm: links.npm } : {}),
            ...(typeof links.repository === 'string' ? { repository: links.repository } : {}),
            ...(typeof links.homepage === 'string' ? { homepage: links.homepage } : {}),
          },
          agentHints: agentHintsFromKeywords(kw),
        },
      });
    }
    return out;
  }

  async packument(name: string): Promise<Packument> {
    validatePackageName(name);
    const doc = await this.json<Packument>(new URL(registryPath(name), this.base));
    if (doc.name !== name)
      throw new SkillScopeError(
        'REGISTRY_ERROR',
        'The registry returned metadata for a different package.',
      );
    return doc;
  }

  async details(name: string): Promise<PackageDetails> {
    const doc = await this.packument(name);
    const versions: PackageVersionSummary[] = Object.values(doc.versions ?? {}).map((v) => ({
      version: v.version,
      publishedAt: doc.time?.[v.version] ?? null,
      deprecated: typeof v.deprecated === 'string' ? v.deprecated : null,
      hasIntegrity: Boolean(v.dist?.integrity || v.dist?.shasum),
      unpackedSize: typeof v.dist?.unpackedSize === 'number' ? v.dist.unpackedSize : null,
      fileCount: typeof v.dist?.fileCount === 'number' ? v.dist.fileCount : null,
    }));
    versions.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const license = typeof doc.license === 'string' ? doc.license : (doc.license?.type ?? null);
    return {
      name: doc.name,
      description: doc.description ?? null,
      distTags: doc['dist-tags'] ?? {},
      versions,
      maintainers: (doc.maintainers ?? [])
        .map((m) => m.name)
        .filter((m): m is string => typeof m === 'string'),
      repository: repositoryUrl(doc.repository),
      homepage:
        typeof doc.homepage === 'string' && /^https?:\/\//.test(doc.homepage) ? doc.homepage : null,
      license,
      keywords: strings(doc.keywords),
    };
  }

  async version(name: string, version: string): Promise<PackumentVersion> {
    validateVersion(version);
    const doc = await this.packument(name);
    const meta = doc.versions?.[version];
    if (!meta)
      throw new SkillScopeError(
        'PACKAGE_NOT_FOUND',
        `Version ${version} of ${name} does not exist.`,
      );
    if (meta.name !== name || meta.version !== version) {
      throw new SkillScopeError(
        'REGISTRY_ERROR',
        'Version metadata does not match the requested package.',
      );
    }
    return meta;
  }

  /** Download a tarball with a hard size limit. */
  async tarball(rawUrl: string, maxBytes = MAX_TARBALL_BYTES): Promise<Uint8Array> {
    const url = this.checkTarballUrl(rawUrl);
    const res = await this.request(url, 'application/octet-stream');
    if (!res.ok)
      throw new SkillScopeError(
        'REGISTRY_ERROR',
        `Downloading the package failed with HTTP ${res.status}.`,
      );
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes)
      throw new SkillScopeError('UNSAFE_ARCHIVE', 'The package archive is larger than 50 MB.');
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SkillScopeError('UNSAFE_ARCHIVE', 'The package archive is larger than 50 MB.');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
}
