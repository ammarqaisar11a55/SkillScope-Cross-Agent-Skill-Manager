import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { AgentId, CustomSkillLocation, Settings as SettingsType } from '@skillscope/shared';
import { AGENT_IDS, DEFAULT_REGISTRY_URL } from '@skillscope/shared';
import { call, errorText } from '../lib/api';
import { agentName } from '../lib/format';
import { useApp } from '../state/app-state';
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ErrorCallout,
  Field,
  Mono,
  Spinner,
  Toggle,
  inputClass,
} from '../components/ui';

export function Settings() {
  const { settings, updateSettings, rescan, info } = useApp();
  const [draft, setDraft] = useState<SettingsType | null>(settings);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(settings), [settings]);
  if (!draft) return <Spinner label="Loading settings…" />;

  const patch = (p: Partial<SettingsType>) => {
    setSaved(false);
    setDraft({ ...draft, ...p });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(draft);
      setSaved(true);
      await rescan();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const pickWorkspace = async () => {
    const dir = await call('dialog:select-directory', { title: 'Select project workspace' }).catch(
      () => null,
    );
    if (dir) patch({ workspaceRoot: dir });
  };

  const addLocation = async () => {
    const dir = await call('dialog:select-directory', { title: 'Select a skills directory' }).catch(
      () => null,
    );
    if (!dir) return;
    const loc: CustomSkillLocation = {
      id: `loc-${Date.now().toString(36)}`,
      agentId: 'claude',
      scope: 'global',
      path: dir,
      label: dir.split(/[\\/]/).filter(Boolean).slice(-2).join('/'),
      installable: false,
    };
    patch({ customLocations: [...draft.customLocations, loc] });
  };

  const updateLocation = (id: string, p: Partial<CustomSkillLocation>) =>
    patch({
      customLocations: draft.customLocations.map((l) => (l.id === id ? { ...l, ...p } : l)),
    });

  return (
    <div className="max-w-3xl space-y-5">
      <Card>
        <CardHeader title="Appearance" />
        <div className="p-4">
          <Field label="Theme">
            <div role="radiogroup" aria-label="Theme" className="flex gap-2">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <Button
                  key={t}
                  role="radio"
                  aria-checked={draft.theme === t}
                  variant={draft.theme === t ? 'primary' : 'secondary'}
                  onClick={async () => {
                    patch({ theme: t });
                    await updateSettings({ theme: t }).catch((e: unknown) =>
                      setError(errorText(e)),
                    );
                  }}
                >
                  {t[0]?.toUpperCase() + t.slice(1)}
                </Button>
              ))}
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Workspace and installation" />
        <div className="space-y-4 p-4">
          <Field
            label="Project workspace"
            hint="Project-level skill folders (.claude/skills, .agents/skills, .cursor/skills) are read from this folder."
          >
            <div className="flex gap-2">
              <input
                className={`${inputClass} w-full`}
                readOnly
                value={draft.workspaceRoot ?? ''}
                placeholder="No workspace selected"
                aria-label="Workspace path"
              />
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void pickWorkspace()}>
                Choose
              </Button>
              {draft.workspaceRoot && (
                <Button onClick={() => patch({ workspaceRoot: null })}>Clear</Button>
              )}
            </div>
          </Field>
          <Field label="Default installation scope">
            <select
              className={`${inputClass} w-48`}
              value={draft.defaultScope}
              onChange={(e) => patch({ defaultScope: e.target.value as 'global' | 'project' })}
            >
              <option value="global">Global (user)</option>
              <option value="project">Project</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Custom skill locations"
          actions={
            <Button icon={<Plus className="size-4" />} onClick={() => void addLocation()}>
              Add
            </Button>
          }
        />
        <div className="space-y-3 p-4">
          {draft.customLocations.length === 0 && (
            <p className="text-sm text-muted">
              No custom locations. SkillScope only scans the documented directories.
            </p>
          )}
          {draft.customLocations.map((l) => (
            <div key={l.id} className="space-y-2 rounded-md border border-border p-3">
              <Mono>{l.path}</Mono>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Agent"
                  className={`${inputClass} w-40`}
                  value={l.agentId}
                  onChange={(e) => updateLocation(l.id, { agentId: e.target.value as AgentId })}
                >
                  {AGENT_IDS.map((a) => (
                    <option key={a} value={a}>
                      {agentName(a)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Scope"
                  className={`${inputClass} w-32`}
                  value={l.scope}
                  onChange={(e) =>
                    updateLocation(l.id, { scope: e.target.value as 'global' | 'project' })
                  }
                >
                  <option value="global">Global</option>
                  <option value="project">Project</option>
                </select>
                <input
                  aria-label="Label"
                  className={`${inputClass} w-48`}
                  value={l.label}
                  onChange={(e) => updateLocation(l.id, { label: e.target.value || 'Custom' })}
                />
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={l.installable}
                    onChange={(e) => updateLocation(l.id, { installable: e.target.checked })}
                  />{' '}
                  Allow installs
                </label>
                <Button
                  variant="ghost"
                  aria-label="Remove location"
                  icon={<Trash2 className="size-4" />}
                  onClick={() =>
                    patch({ customLocations: draft.customLocations.filter((x) => x.id !== l.id) })
                  }
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">
            Adding a location here only changes what SkillScope scans. It never changes an agent's
            own configuration.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="npm registry" />
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Field
              label="Registry URL"
              hint={`Default: ${DEFAULT_REGISTRY_URL}. Credentials are never stored or sent.`}
            >
              <input
                className={`${inputClass} w-full`}
                value={draft.registry.url}
                onChange={(e) => patch({ registry: { ...draft.registry, url: e.target.value } })}
              />
            </Field>
          </div>
          <Field label="Timeout (ms)">
            <input
              type="number"
              min={1000}
              max={120000}
              className={`${inputClass} w-full`}
              value={draft.registry.timeoutMs}
              onChange={(e) =>
                patch({ registry: { ...draft.registry, timeoutMs: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="Retries">
            <input
              type="number"
              min={0}
              max={5}
              className={`${inputClass} w-full`}
              value={draft.registry.retries}
              onChange={(e) =>
                patch({ registry: { ...draft.registry, retries: Number(e.target.value) } })
              }
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Scanning" />
        <div className="space-y-1 p-4">
          <Toggle
            label="Scan on startup"
            checked={draft.scan.scanOnStartup}
            onChange={(v) => patch({ scan: { ...draft.scan, scanOnStartup: v } })}
          />
          <Toggle
            label="Follow symbolic links"
            checked={draft.scan.followSymlinks}
            onChange={(v) => patch({ scan: { ...draft.scan, followSymlinks: v } })}
          />
          <Toggle
            label="Include system and enterprise locations"
            checked={draft.scan.includeSystemRoots}
            onChange={(v) => patch({ scan: { ...draft.scan, includeSystemRoots: v } })}
          />
          <div className="pt-2">
            <Field
              label="Maximum category depth"
              hint="How deep Cursor-style category folders are scanned (1–6)."
            >
              <input
                type="number"
                min={1}
                max={6}
                className={`${inputClass} w-24`}
                value={draft.scan.maxDepth}
                onChange={(e) =>
                  patch({ scan: { ...draft.scan, maxDepth: Number(e.target.value) } })
                }
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="History, security and privacy" />
        <div className="space-y-3 p-4">
          <Field label="Keep history for (days)">
            <input
              type="number"
              min={1}
              max={3650}
              className={`${inputClass} w-24`}
              value={draft.historyRetentionDays}
              onChange={(e) => patch({ historyRetentionDays: Number(e.target.value) })}
            />
          </Field>
          <Toggle
            label="Allow network access to the npm registry"
            checked={draft.privacy.allowNetwork}
            onChange={(v) => patch({ privacy: { allowNetwork: v } })}
          />
          <Callout tone="info">
            SkillScope collects no telemetry and never uploads skill contents. Package lifecycle
            scripts are never run. Data is stored locally in{' '}
            <Mono>{info?.dataDirectory ?? '…'}</Mono>.
          </Callout>
        </div>
      </Card>

      <ErrorCallout error={error} />
      {saved && <Callout tone="ok" title="Settings saved" />}
      <div className="flex gap-2">
        <Button variant="primary" busy={saving} onClick={() => void save()}>
          Save settings
        </Button>
        <Button onClick={() => setDraft(settings)}>Discard changes</Button>
      </div>
    </div>
  );
}
