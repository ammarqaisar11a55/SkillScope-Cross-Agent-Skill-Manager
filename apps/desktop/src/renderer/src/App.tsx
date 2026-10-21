import { useEffect, useState } from 'react';
import type { AppInfo } from '@skillscope/shared';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.skillscope.invoke('app:info').then((result) => {
      if (result.ok) setInfo(result.value);
      else setError(result.error.message);
    });
  }, []);

  return (
    <main className="flex h-full items-center justify-center">
      <div className="rounded-xl border border-border bg-surface-2 p-8 text-center">
        <h1 className="text-xl font-semibold">SkillScope</h1>
        {info && (
          <p className="mt-2 text-muted" data-testid="app-info">
            v{info.version} · {info.platform}/{info.arch} · Electron {info.electron}
          </p>
        )}
        {error && <p className="mt-2 text-bad">{error}</p>}
      </div>
    </main>
  );
}
