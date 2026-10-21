import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppInfo,
  InventorySnapshot,
  OperationProgress,
  Settings,
  SettingsPatch,
} from '@skillscope/shared';
import { call, errorText } from '../lib/api';

export interface AppState {
  info: AppInfo | null;
  settings: Settings | null;
  inventory: InventorySnapshot | null;
  scanning: boolean;
  scanError: { message: string; hint?: string } | null;
  progress: OperationProgress | null;
  rescan(): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp must be used inside AppStateProvider');
  return value;
}

function applyTheme(theme: Settings['theme']): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const dark = theme === 'dark' || (theme === 'system' && media.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  update();
  if (theme !== 'system') return () => undefined;
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<AppState['scanError']>(null);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const started = useRef(false);

  const rescan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      setInventory(await call('inventory:scan'));
    } catch (error) {
      setScanError(errorText(error));
    } finally {
      setScanning(false);
    }
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    const next = await call('settings:update', patch);
    setSettings(next);
    return next;
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const [appInfo, loaded, cached] = await Promise.all([
          call('app:info'),
          call('settings:get'),
          call('inventory:cached'),
        ]);
        setInfo(appInfo);
        setSettings(loaded);
        if (cached) setInventory(cached);
        if (loaded.scan.scanOnStartup || !cached) await rescan();
      } catch (error) {
        setScanError(errorText(error));
      }
    })();
  }, [rescan]);

  useEffect(() => (settings ? applyTheme(settings.theme) : undefined), [settings?.theme, settings]);

  useEffect(() => {
    const offProgress = window.skillscope.onProgress(setProgress);
    const offInventory = window.skillscope.onInventoryUpdated(() => void rescan());
    return () => {
      offProgress();
      offInventory();
    };
  }, [rescan]);

  const value = useMemo<AppState>(
    () => ({ info, settings, inventory, scanning, scanError, progress, rescan, updateSettings }),
    [info, settings, inventory, scanning, scanError, progress, rescan, updateSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
