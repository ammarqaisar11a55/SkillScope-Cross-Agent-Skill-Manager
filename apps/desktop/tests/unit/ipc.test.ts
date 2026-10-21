import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

const { dispatch } = await import('../../src/main/ipc.js');

const event = { senderFrame: { url: 'file:///app/index.html' } } as unknown as IpcMainInvokeEvent;
const trusted = () => true;

describe('IPC dispatch', () => {
  it('rejects untrusted senders before calling the handler', async () => {
    const handler = vi.fn();
    const result = await dispatch('inventory:scan', handler, undefined, event, () => false);
    expect(result.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads before calling the handler', async () => {
    const handler = vi.fn();
    const result = await dispatch(
      'inventory:read-file',
      handler,
      { skillId: 'x', path: '../../etc/passwd' },
      event,
      trusted,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_REQUEST');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes validated payloads and wraps the value', async () => {
    const handler = vi.fn(async (p: { name: string }) => ({ name: p.name }));
    const result = await dispatch(
      'registry:details',
      handler as never,
      { name: '@acme/skills' },
      event,
      trusted,
    );
    expect(result).toEqual({ ok: true, value: { name: '@acme/skills' } });
  });

  it('converts thrown errors into serialised errors without secrets', async () => {
    const handler = vi.fn(async () => {
      throw Object.assign(new Error('open https://u:secret@host failed'), { code: 'EACCES' });
    });
    const result = await dispatch('inventory:scan', handler as never, undefined, event, trusted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.message).not.toContain('secret');
    }
  });
});
