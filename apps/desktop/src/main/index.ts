import { writeFile } from 'node:fs/promises';
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

  // Release smoke test: packaged builds disable the inspector (fuses), so the app checks itself
  // and writes a report to the path given in SKILLSCOPE_SMOKE_TEST, then exits.
  const smokeReport = process.env.SKILLSCOPE_SMOKE_TEST;
  if (smokeReport) {
    const win = mainWindow;
    win.webContents.once('did-finish-load', () => {
      void (async () => {
        const report: Record<string, unknown> = {
          version: app.getVersion(),
          packaged: app.isPackaged,
        };
        try {
          report.title = await win.webContents.executeJavaScript('document.title');
          report.bridge = await win.webContents.executeJavaScript(
            'typeof window.skillscope?.invoke',
          );
          report.nodeInRenderer = await win.webContents.executeJavaScript('typeof require');
          const snapshot = await service.scan();
          report.uniqueSkills = snapshot.stats.uniqueSkills;
          report.ok =
            report.title === 'SkillScope' &&
            report.bridge === 'function' &&
            report.nodeInRenderer === 'undefined';
        } catch (error) {
          report.ok = false;
          report.error = error instanceof Error ? error.message : String(error);
        }
        await writeFile(smokeReport, JSON.stringify(report, null, 2));
        app.exit(report.ok ? 0 : 1);
      })();
    });
  }
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
