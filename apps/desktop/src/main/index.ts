import { app, BrowserWindow } from 'electron';
import { SkillScopeError } from '@skillscope/shared';
import { registerIpcHandlers, type IpcHandlers } from './ipc.js';
import { applySessionSecurity } from './security.js';
import { createMainWindow, isAppUrl, type WindowOptions } from './window.js';

const windowOptions: WindowOptions = {
  devServerUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
};

function notReady(): never {
  throw new SkillScopeError('INTERNAL', 'The skill engine is not available in this build yet.');
}

function createHandlers(): IpcHandlers {
  return {
    'app:info': () => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      dataDirectory: app.getPath('userData'),
    }),
    'inventory:scan': notReady,
    'inventory:cached': () => null,
    'inventory:skill-details': notReady,
    'inventory:read-file': notReady,
    'inventory:reveal': notReady,
    'registry:search': notReady,
    'registry:details': notReady,
    'packages:inspect': notReady,
    'packages:discard': notReady,
    'install:plan': notReady,
    'install:execute': notReady,
    'receipts:list': () => [],
    'operations:list': () => [],
    'updates:check': () => [],
    'updates:preview': notReady,
    'updates:apply': notReady,
    'removal:preview': notReady,
    'removal:execute': notReady,
    'backups:restore': notReady,
    'settings:get': notReady,
    'settings:update': notReady,
    'dialog:select-directory': notReady,
    'export:inventory': notReady,
  };
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

  void app.whenReady().then(() => {
    applySessionSecurity(Boolean(windowOptions.devServerUrl));
    registerIpcHandlers(createHandlers(), (event) =>
      isAppUrl(event.senderFrame?.url ?? '', windowOptions),
    );
    createMainWindow(windowOptions);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(windowOptions);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
