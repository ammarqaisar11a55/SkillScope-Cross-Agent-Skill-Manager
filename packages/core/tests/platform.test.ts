import { describe, expect, it } from 'vitest';
import {
  AdapterRegistry,
  createPlatformContext,
  exceedsPathLimit,
  expandUserPath,
  isInside,
  pathKey,
  samePath,
  toPosixRelative,
  type AdapterContext,
} from '../src/index.js';

function ctxFor(
  platform: 'linux' | 'win32',
  home: string,
  workspace: string | null,
  env: Record<string, string> = {},
): AdapterContext {
  return {
    platform: createPlatformContext({ platform, homeDir: home, env }),
    workspaceRoot: workspace,
    includeSystemRoots: true,
    maxDepth: 4,
    customLocations: [],
  };
}

const registry = new AdapterRegistry();

function rootPaths(ctx: AdapterContext, agent: 'claude' | 'codex' | 'cursor') {
  return Object.fromEntries(
    registry
      .get(agent)
      .roots(ctx)
      .map((r) => [r.id, r.path]),
  );
}

describe('platform context', () => {
  it('compares Windows paths case-insensitively and Linux paths case-sensitively', () => {
    const win = createPlatformContext({ platform: 'win32', homeDir: 'C:\\Users\\Ada' });
    const lin = createPlatformContext({ platform: 'linux', homeDir: '/home/ada' });
    expect(samePath(win, 'C:\\Users\\Ada\\.claude', 'c:\\users\\ada\\.CLAUDE\\')).toBe(true);
    expect(samePath(lin, '/home/ada/.claude', '/home/ada/.Claude')).toBe(false);
    expect(pathKey(lin, '/home/ada/x/')).toBe('/home/ada/x');
  });

  it('detects containment without being fooled by prefixes or traversal', () => {
    const lin = createPlatformContext({ platform: 'linux', homeDir: '/home/ada' });
    expect(isInside(lin, '/a/skills', '/a/skills/x')).toBe(true);
    expect(isInside(lin, '/a/skills', '/a/skills-evil/x')).toBe(false);
    expect(isInside(lin, '/a/skills', '/a/skills/../x')).toBe(false);
    expect(isInside(lin, '/a/skills', '/a/skills', false)).toBe(false);
    const win = createPlatformContext({ platform: 'win32', homeDir: 'C:\\Users\\Ada' });
    expect(isInside(win, 'C:\\a\\skills', 'c:\\A\\Skills\\x')).toBe(true);
    expect(isInside(win, 'C:\\a\\skills', 'D:\\a\\skills\\x')).toBe(false);
  });

  it('expands ~ and environment variables', () => {
    const win = createPlatformContext({
      platform: 'win32',
      homeDir: 'C:\\Users\\Ada',
      env: { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' },
    });
    expect(expandUserPath(win, '~\\skills')).toBe('C:\\Users\\Ada\\skills');
    expect(expandUserPath(win, '%APPDATA%\\x')).toBe('C:\\Users\\Ada\\AppData\\Roaming\\x');
    const lin = createPlatformContext({ platform: 'linux', homeDir: '/home/ada', env: {} });
    expect(expandUserPath(lin, '~/skills')).toBe('/home/ada/skills');
    expect(expandUserPath(lin, '$HOME/skills')).toBe('/home/ada/skills');
  });

  it('produces POSIX relative paths on Windows', () => {
    const win = createPlatformContext({ platform: 'win32', homeDir: 'C:\\Users\\Ada' });
    expect(toPosixRelative(win, 'C:\\s', 'C:\\s\\a\\b.md')).toBe('a/b.md');
  });

  it('flags Windows paths at MAX_PATH', () => {
    const win = createPlatformContext({ platform: 'win32', homeDir: 'C:\\Users\\Ada' });
    expect(exceedsPathLimit(win, `C:\\${'a'.repeat(300)}`)).toBe(true);
    expect(exceedsPathLimit(win, 'C:\\short')).toBe(false);
  });
});

describe('adapter path resolution', () => {
  it('resolves Linux user and project roots', () => {
    const ctx = ctxFor('linux', '/home/ada', '/home/ada/work/app');
    expect(rootPaths(ctx, 'claude')).toMatchObject({
      'claude:global:personal': '/home/ada/.claude/skills',
      'claude:global:synced': '/home/ada/.claude/skills/synced',
      'claude:project:project': '/home/ada/work/app/.claude/skills',
      'claude:system:enterprise': '/etc/claude-code/.claude/skills',
    });
    expect(rootPaths(ctx, 'codex')).toMatchObject({
      'codex:global:user': '/home/ada/.agents/skills',
      'codex:project:repo': '/home/ada/work/app/.agents/skills',
      'codex:system:admin': '/etc/codex/skills',
    });
    expect(rootPaths(ctx, 'cursor')).toMatchObject({
      'cursor:global:user-cursor': '/home/ada/.cursor/skills',
      'cursor:global:user-agents': '/home/ada/.agents/skills',
      'cursor:global:compat-claude': '/home/ada/.claude/skills',
      'cursor:global:compat-codex': '/home/ada/.codex/skills',
      'cursor:project:project-cursor': '/home/ada/work/app/.cursor/skills',
      'cursor:project:project-agents': '/home/ada/work/app/.agents/skills',
    });
  });

  it('resolves Windows roots with native separators and no Unix-only system roots', () => {
    const ctx = ctxFor('win32', 'C:\\Users\\Ada', 'D:\\src\\app', {
      ProgramFiles: 'C:\\Program Files',
    });
    const claude = rootPaths(ctx, 'claude');
    expect(claude['claude:global:personal']).toBe('C:\\Users\\Ada\\.claude\\skills');
    expect(claude['claude:project:project']).toBe('D:\\src\\app\\.claude\\skills');
    expect(claude['claude:system:enterprise']).toBe(
      'C:\\Program Files\\ClaudeCode\\.claude\\skills',
    );
    const codex = rootPaths(ctx, 'codex');
    expect(codex['codex:global:user']).toBe('C:\\Users\\Ada\\.agents\\skills');
    expect(codex['codex:system:admin']).toBeUndefined();
    expect(rootPaths(ctx, 'cursor')['cursor:global:user-cursor']).toBe(
      'C:\\Users\\Ada\\.cursor\\skills',
    );
  });

  it('honours CLAUDE_CONFIG_DIR', () => {
    const ctx = ctxFor('linux', '/home/ada', null, { CLAUDE_CONFIG_DIR: '/opt/claude-config' });
    expect(rootPaths(ctx, 'claude')['claude:global:personal']).toBe('/opt/claude-config/skills');
  });

  it('omits project roots when no workspace is selected', () => {
    const ctx = ctxFor('linux', '/home/ada', null);
    for (const adapter of registry.all()) {
      expect(adapter.roots(ctx).filter((r) => r.scope === 'project')).toEqual([]);
    }
  });

  it('never offers system or compatibility roots as install targets', () => {
    const ctx = ctxFor('linux', '/home/ada', '/w');
    for (const adapter of registry.all()) {
      for (const scope of ['global', 'project'] as const) {
        const targets = adapter.installRoots(ctx, scope);
        expect(targets.length).toBeGreaterThan(0);
        for (const t of targets) {
          expect(t.scope).toBe(scope);
          expect(t.relation).toBe('native');
        }
      }
    }
  });

  it('defaults each agent to its own directory', () => {
    const ctx = ctxFor('linux', '/home/ada', '/w');
    expect(registry.get('claude').installRoots(ctx, 'global')[0]?.path).toBe(
      '/home/ada/.claude/skills',
    );
    expect(registry.get('codex').installRoots(ctx, 'global')[0]?.path).toBe(
      '/home/ada/.agents/skills',
    );
    expect(registry.get('cursor').installRoots(ctx, 'global')[0]?.path).toBe(
      '/home/ada/.cursor/skills',
    );
    expect(registry.get('cursor').installRoots(ctx, 'project')[0]?.path).toBe('/w/.cursor/skills');
  });

  it('adds custom locations, resolving project-relative paths against the workspace', () => {
    const ctx: AdapterContext = {
      ...ctxFor('linux', '/home/ada', '/w'),
      customLocations: [
        {
          id: 'team',
          agentId: 'claude',
          scope: 'global',
          path: '~/team-skills',
          label: 'Team',
          installable: true,
        },
        {
          id: 'rel',
          agentId: 'claude',
          scope: 'project',
          path: 'tools/skills',
          label: 'Rel',
          installable: false,
        },
      ],
    };
    const roots = registry.get('claude').roots(ctx);
    expect(roots.find((r) => r.id === 'claude:custom:team')?.path).toBe('/home/ada/team-skills');
    expect(roots.find((r) => r.id === 'claude:custom:rel')?.path).toBe('/w/tools/skills');
    expect(
      registry
        .get('claude')
        .installRoots(ctx, 'global')
        .map((r) => r.id),
    ).toContain('claude:custom:team');
  });
});
