import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_EVENT_INVENTORY_UPDATED,
  IPC_EVENT_PROGRESS,
  isIpcChannel,
  type OperationProgress,
  type SkillScopeApi,
} from '@skillscope/shared';

/**
 * The only surface the renderer can reach. It forwards to a fixed allow-list of channels; the
 * main process validates every payload again before acting on it.
 */
const api: SkillScopeApi = {
  invoke: ((channel: string, payload?: unknown) => {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'INVALID_REQUEST', message: `Unknown channel ${channel}` },
      });
    }
    return ipcRenderer.invoke(channel, payload);
  }) as SkillScopeApi['invoke'],
  onProgress(listener) {
    const wrapped = (_event: IpcRendererEvent, progress: OperationProgress) => listener(progress);
    ipcRenderer.on(IPC_EVENT_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IPC_EVENT_PROGRESS, wrapped);
  },
  onInventoryUpdated(listener) {
    const wrapped = () => listener();
    ipcRenderer.on(IPC_EVENT_INVENTORY_UPDATED, wrapped);
    return () => ipcRenderer.removeListener(IPC_EVENT_INVENTORY_UPDATED, wrapped);
  },
};

contextBridge.exposeInMainWorld('skillscope', api);
