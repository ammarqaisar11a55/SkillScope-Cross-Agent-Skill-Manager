import { useState, type ReactNode } from 'react';
import {
  Bot,
  LayoutDashboard,
  Layers,
  Package,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  Store,
} from 'lucide-react';
import { AppStateProvider, useApp } from './state/app-state';
import { Button, Callout, ErrorCallout } from './components/ui';
import { GitHubButton } from './components/GitHubButton';
import { relativeTime } from './lib/format';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Agents } from './pages/Agents';
import { Marketplace } from './pages/Marketplace';
import { Installations } from './pages/Installations';
import { Validation } from './pages/Validation';
import { Settings } from './pages/Settings';

export type Page =
  | 'dashboard'
  | 'inventory'
  | 'agents'
  | 'marketplace'
  | 'installations'
  | 'validation'
  | 'settings';

const NAV: { id: Page; label: string; icon: ReactNode; group: 'local' | 'packages' | 'app' }[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard className="size-4" />,
    group: 'local',
  },
  { id: 'inventory', label: 'Skills', icon: <Layers className="size-4" />, group: 'local' },
  { id: 'agents', label: 'Agents', icon: <Bot className="size-4" />, group: 'local' },
  {
    id: 'validation',
    label: 'Validation',
    icon: <ShieldAlert className="size-4" />,
    group: 'local',
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: <Store className="size-4" />,
    group: 'packages',
  },
  {
    id: 'installations',
    label: 'Installations',
    icon: <Package className="size-4" />,
    group: 'packages',
  },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon className="size-4" />, group: 'app' },
];

/** Wordmark: three lane dots, the same marks the reach map uses for Claude Code, Codex and Cursor. */
function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
      <span aria-hidden className="flex gap-[3px]">
        <span className="size-2 rounded-full bg-lane-claude" />
        <span className="size-2 rounded-full bg-lane-codex" />
        <span className="size-2 rounded-full bg-lane-cursor" />
      </span>
      <span className="text-[1.0625rem] font-semibold tracking-[-0.01em]">SkillScope</span>
    </div>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>('dashboard');
  const { inventory, scanning, scanError, rescan, info } = useApp();
  const current = NAV.find((n) => n.id === page);
  const problems = inventory?.stats.problematicSkills ?? 0;

  const item = (n: (typeof NAV)[number]) => (
    <li key={n.id}>
      <button
        type="button"
        aria-label={n.label}
        aria-current={page === n.id ? 'page' : undefined}
        onClick={() => setPage(n.id)}
        className={`relative flex w-full items-center gap-2.5 rounded-control px-3 py-1.5 text-sm transition-colors ${
          page === n.id
            ? 'bg-surface-3 font-medium text-fg'
            : 'text-muted hover:bg-surface-3/60 hover:text-fg'
        }`}
      >
        {page === n.id && (
          <span
            aria-hidden
            className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-accent"
          />
        )}
        {n.icon}
        <span className="flex-1 text-left">{n.label}</span>
        {n.id === 'validation' && problems > 0 && (
          <span
            aria-hidden
            className="tabular rounded-full bg-bad/15 px-1.5 text-2xs font-semibold text-bad"
          >
            {problems}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <div className="flex h-full">
      <nav
        aria-label="Main"
        className="flex w-52 shrink-0 flex-col border-r border-rule bg-surface-2"
      >
        <Wordmark />
        <div className="flex-1 space-y-5 px-2">
          <ul className="space-y-0.5">{NAV.filter((n) => n.group === 'local').map(item)}</ul>
          <div>
            <p className="px-3 pb-1 text-xs text-muted">npm packages</p>
            <ul className="space-y-0.5">{NAV.filter((n) => n.group === 'packages').map(item)}</ul>
          </div>
          <ul className="space-y-0.5">{NAV.filter((n) => n.group === 'app').map(item)}</ul>
        </div>
        <div className="space-y-1 border-t border-rule px-2 py-3">
          <GitHubButton />
          {info && (
            <p className="px-3 text-xs text-muted">
              Version {info.version} for{' '}
              {info.platform === 'win32'
                ? 'Windows'
                : info.platform === 'linux'
                  ? 'Linux'
                  : info.platform}
            </p>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-rule px-8">
          {page === 'dashboard' ? (
            <span />
          ) : (
            <h1 className="text-lg font-semibold tracking-[-0.01em]">{current?.label}</h1>
          )}
          <div className="flex items-center gap-3 text-xs text-muted">
            {inventory && (
              <span data-testid="last-scan">
                {inventory.fromCache ? 'Showing saved inventory from' : 'Scanned'}{' '}
                {relativeTime(inventory.generatedAt)}
              </span>
            )}
            <Button
              icon={<RefreshCw className={`size-4 ${scanning ? 'animate-spin' : ''}`} />}
              disabled={scanning}
              onClick={() => void rescan()}
            >
              {scanning ? 'Scanning…' : 'Rescan'}
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto px-8 py-6">
          {scanError && (
            <div className="mb-4">
              <ErrorCallout error={scanError} />
            </div>
          )}
          {inventory?.fromCache && !scanning && page !== 'settings' && (
            <div className="mb-4">
              <Callout tone="info" title="You are looking at the last saved inventory">
                Rescan to read your skill folders again.
              </Callout>
            </div>
          )}
          {page === 'dashboard' && <Dashboard navigate={setPage} />}
          {page === 'inventory' && <Inventory />}
          {page === 'agents' && <Agents />}
          {page === 'marketplace' && <Marketplace />}
          {page === 'installations' && <Installations />}
          {page === 'validation' && <Validation />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
