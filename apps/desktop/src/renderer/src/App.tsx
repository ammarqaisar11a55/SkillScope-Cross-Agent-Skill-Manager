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

const NAV: { id: Page; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'inventory', label: 'Skills', icon: <Layers className="size-4" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="size-4" /> },
  { id: 'marketplace', label: 'Marketplace', icon: <Store className="size-4" /> },
  { id: 'installations', label: 'Installations', icon: <Package className="size-4" /> },
  { id: 'validation', label: 'Validation', icon: <ShieldAlert className="size-4" /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon className="size-4" /> },
];

function Shell() {
  const [page, setPage] = useState<Page>('dashboard');
  const { inventory, scanning, scanError, rescan, info } = useApp();
  const current = NAV.find((n) => n.id === page);
  const problems = inventory?.stats.problematicSkills ?? 0;

  return (
    <div className="flex h-full">
      <nav
        aria-label="Main"
        className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-2"
      >
        <div className="px-4 py-4">
          <p className="text-base font-semibold tracking-tight">SkillScope</p>
          <p className="text-xs text-muted">Cross-agent skill manager</p>
        </div>
        <ul className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${
                  page === n.id
                    ? 'bg-accent/12 font-medium text-accent'
                    : 'text-fg hover:bg-surface-3'
                }`}
              >
                {n.icon}
                <span className="flex-1 text-left">{n.label}</span>
                {n.id === 'validation' && problems > 0 && (
                  <span className="rounded bg-bad/15 px-1.5 text-xs font-medium text-bad">
                    {problems}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-border px-2 py-3">
          <GitHubButton />
          <p className="px-2.5 text-xs text-muted">
            {info ? `v${info.version} · ${info.platform}` : ''}
          </p>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <h1 className="text-lg font-semibold">{current?.label}</h1>
          <div className="flex items-center gap-3 text-xs text-muted">
            {inventory && (
              <span data-testid="last-scan">
                {inventory.fromCache ? 'Cached inventory' : 'Scanned'}{' '}
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
        <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {scanError && (
            <div className="mb-4">
              <ErrorCallout error={scanError} />
            </div>
          )}
          {inventory?.fromCache && !scanning && page !== 'settings' && (
            <div className="mb-4">
              <Callout tone="info" title="Showing the last saved inventory">
                Rescan to read the current state of your skill folders.
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
