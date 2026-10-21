import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, nativeTheme } from 'electron';
import { hardenWebContents } from './security.js';

export interface WindowOptions {
  devServerUrl: string | undefined;
}

export function rendererEntry(options: WindowOptions): string {
  if (options.devServerUrl) return options.devServerUrl;
  return pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).toString();
}

export function isAppUrl(url: string, options: WindowOptions): boolean {
  const entry = rendererEntry(options);
  if (options.devServerUrl) return url.startsWith(options.devServerUrl);
  return url.split('#')[0] === entry;
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'SkillScope',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#f7f8fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  hardenWebContents(win.webContents, (url) => isAppUrl(url, options));
  win.once('ready-to-show', () => win.show());
  void win.loadURL(rendererEntry(options));
  return win;
}
