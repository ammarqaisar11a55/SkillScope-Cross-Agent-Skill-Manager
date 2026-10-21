import { join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { IPC_EVENT_PROGRESS } from '@skillscope/shared';
import { SkillScopeApp, SkillScopeStore, createPlatformContext } from '@skillscope/core';
import { createHandlers } from './handlers.js';
import { registerIpcHandlers } from './ipc.js';
import { applySessionSecurity } from './security.js';
import { createMainWindow, isAppUrl, type WindowOptions } from './window.js';

const windowOptions: WindowOptions = {
  devServerUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
};

// Isolated directories for automated tests; never set in normal use.
const dataDir = process.env.SKILLSCOPE_DATA_DIR || app.getPath('userData');
const homeOverride = process.env.SKILLSCOPE_HOME_OVERRIDE || undefined;
if (process.env.SKILLSCOPE_DATA_DIR) app.setPath('userData', dataDir);

async function start(): Promise<void> {
  applySessionSecurity(Boolean(windowOptions.devServerUrl));
  const store = await SkillScopeStore.open(join(dataDir, 'skillscope.db'));
  const service = new SkillScopeApp({
    store,
    dataDir,
    platform: createPlatformContext(homeOverride ? { homeDir: homeOverride } : {}),
    offline: process.env.SKILLSCOPE_OFFLINE === '1',
  });
  await service
    .initialize()
    .catch((error: unknown) => console.error('Startup recovery failed:', error));

  let mainWindow: BrowserWindow | null = null;
  const parent = () => mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
  service.log.onProgress((progress) => mainWindow?.webContents.send(IPC_EVENT_PROGRESS, progress));

  registerIpcHandlers(
    createHandlers(service, {
      appInfo: () => ({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        dataDirectory: dataDir,
      }),
      async selectDirectory(title) {
        const win = parent();
        const result = win
          ? await dialog.showOpenDialog(win, {
              title,
              properties: ['openDirectory', 'createDirectory'],
            })
          : await dialog.showOpenDialog({
              title,
              properties: ['openDirectory', 'createDirectory'],
            });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      async saveFile(defaultName, extension) {
        const options = {
          defaultPath: defaultName,
          filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
        };
        const win = parent();
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
        return result.canceled ? null : (result.filePath ?? null);
      },
      async revealInFileManager(path) {
        const error = await shell.openPath(path);
        if (error) shell.showItemInFolder(path);
      },
    }),
    (event) => isAppUrl(event.senderFrame?.url ?? '', windowOptions),
  );

  mainWindow = createMainWindow(windowOptions);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(windowOptions);
  });
  app.on('will-quit', () => store.close());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      console.error(error);
      dialog.showErrorBox(
        'SkillScope could not start',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
