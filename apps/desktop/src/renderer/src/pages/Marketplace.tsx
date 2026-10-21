import { useEffect, useState } from 'react';
import { ExternalLink, PackageSearch, Search } from 'lucide-react';
import type {
  AgentId,
  PackageDetails,
  PackageInspection,
  RegistrySearchPage,
} from '@skillscope/shared';
import { AGENT_IDS } from '@skillscope/shared';
import { call, errorText } from '../lib/api';
import { agentName, formatDate } from '../lib/format';
import { useApp } from '../state/app-state';
import { InspectionSummary, InstallFlow } from '../components/InstallFlow';
import { OperationProgressBar } from '../components/OperationProgressBar';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorCallout,
  Spinner,
  inputClass,
} from '../components/ui';

export function Marketplace() {
  const { settings, rescan } = useApp();
  const [text, setText] = useState('');
  const [agents, setAgents] = useState<AgentId[]>([]);
  const [page, setPage] = useState<RegistrySearchPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<PackageDetails | null>(null);
  const [version, setVersion] = useState('');
  const [inspection, setInspection] = useState<PackageInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      setPage(
        await call('registry:search', { text, ...(agents.length ? { agents } : {}), size: 25 }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    setDetails(null);
    setInspection(null);
    setError(null);
    void call('registry:details', { name: selected }).then(
      (d) => {
        setDetails(d);
        setVersion(d.distTags.latest ?? d.versions[0]?.version ?? '');
      },
      (e: unknown) => setError(errorText(e)),
    );
  }, [selected]);

  const inspect = async () => {
    if (!details || !version) return;
    if (inspection)
      void call('packages:discard', { stagingId: inspection.stagingId }).catch(() => undefined);
    setInspecting(true);
    setInspection(null);
    setError(null);
    try {
      setInspection(await call('packages:inspect', { name: details.name, version }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setInspecting(false);
    }
  };

  if (settings && !settings.privacy.allowNetwork) {
    return (
      <Callout tone="info" title="Network access is turned off">
        Enable “Allow network access to the npm registry” in Settings to search for skill packages.
        Your existing inventory keeps working offline.
      </Callout>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(20rem,26rem)_1fr]">
      <div className="space-y-3">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" />
              <input
                className={`${inputClass} w-full pl-8`}
                aria-label="Search npm"
                placeholder="Keyword or package name"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" busy={searching}>
              Search
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {AGENT_IDS.map((a) => (
              <label key={a} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={agents.includes(a)}
                  onChange={() =>
                    setAgents(agents.includes(a) ? agents.filter((x) => x !== a) : [...agents, a])
                  }
                />
                {agentName(a)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Searches npm for agent-skill, claude-code-skill, codex-skill and cursor-skill keywords.
            Keywords help discovery; they do not prove a package is safe or compatible.
          </p>
        </form>
        <ErrorCallout error={!selected ? error : null} />
        <Card>
          {!page ? (
            <EmptyState icon={<PackageSearch className="size-6" />} title="Search the npm registry">
              Packages are validated before installation is offered.
            </EmptyState>
          ) : page.results.length === 0 ? (
            <EmptyState title="No packages found" />
          ) : (
            <ul className="divide-y divide-border">
              {page.results.map((r) => (
                <li key={r.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.name)}
                    className={`w-full px-4 py-3 text-left hover:bg-surface-3 ${selected === r.name ? 'bg-accent/8' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-xs text-muted">{r.version}</span>
                    </div>
                    {r.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{r.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.agentHints.map((a) => (
                        <Badge key={a} tone="accent" title="From package keywords">
                          {agentName(a)}
                        </Badge>
                      ))}
                      {r.publisher && <Badge>by {r.publisher}</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        {!selected ? (
          <Card>
            <EmptyState title="Select a package to see its details" />
          </Card>
        ) : !details ? (
          error ? (
            <ErrorCallout error={error} />
          ) : (
            <Spinner label="Loading package…" />
          )
        ) : (
          <>
            <Card>
              <CardHeader title={details.name} subtitle={details.description ?? undefined} />
              <div className="space-y-3 p-4 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted">
                  <span>License: {details.license ?? 'unknown'}</span>
                  <span>Maintainers: {details.maintainers.join(', ') || 'unknown'}</span>
                  {details.repository && (
                    <a
                      href={details.repository}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> Repository
                    </a>
                  )}
                  {details.homepage && (
                    <a
                      href={details.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> Homepage
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Version"
                    className={`${inputClass} w-64`}
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                  >
                    {details.versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version}
                        {details.distTags.latest === v.version ? ' (latest)' : ''}
                        {v.deprecated ? ', deprecated' : ''}, published {formatDate(v.publishedAt)}
                      </option>
                    ))}
                  </select>
                  <Button variant="primary" busy={inspecting} onClick={() => void inspect()}>
                    Inspect package
                  </Button>
                </div>
                {inspecting && <OperationProgressBar kinds={['install']} />}
                <ErrorCallout error={error} />
              </div>
            </Card>
            {inspection && (
              <>
                <Card>
                  <CardHeader
                    title="Contents and validation"
                    subtitle="Downloaded to a private temporary folder. No package scripts were run."
                  />
                  <div className="p-4">
                    <InspectionSummary inspection={inspection} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Install" />
                  <div className="space-y-3 p-4">
                    <Callout tone="warn" title="Third-party content">
                      A skill's instructions and bundled scripts come from the package author and
                      may influence how your coding agent behaves. Declared agent support is a
                      claim, not a guarantee.
                    </Callout>
                    <InstallFlow inspection={inspection} onDone={() => void rescan()} />
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
