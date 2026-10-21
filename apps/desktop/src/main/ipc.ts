import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  err,
  ok,
  toSerializedError,
  validateIpcPayload,
  type IpcChannel,
  type IpcPayload,
  type IpcResponses,
  type Result,
} from '@skillscope/shared';

export type IpcHandler<C extends IpcChannel> = (
  payload: IpcPayload<C>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResponses[C]> | IpcResponses[C];

export type IpcHandlers = { [C in IpcChannel]: IpcHandler<C> };

/**
 * Handle one IPC request: reject untrusted senders, validate the payload against its schema and
 * convert every outcome into a serialisable Result. Exported for unit testing.
 */
export async function dispatch<C extends IpcChannel>(
  channel: C,
  handler: IpcHandler<C>,
  rawPayload: unknown,
  event: IpcMainInvokeEvent,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): Promise<Result<IpcResponses[C]>> {
  if (!isTrustedSender(event)) {
    return err({ code: 'INVALID_REQUEST', message: 'Request rejected: untrusted sender.' });
  }
  const check = validateIpcPayload(channel, rawPayload);
  if (!check.ok) {
    return err({
      code: 'INVALID_REQUEST',
      message: `Invalid request for ${channel}: ${check.message}`,
    });
  }
  try {
    return ok(await handler(check.value, event));
  } catch (error) {
    return err(toSerializedError(error));
  }
}

export function registerIpcHandlers(
  handlers: IpcHandlers,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  for (const channel of IPC_CHANNELS) {
    const handler = handlers[channel] as IpcHandler<typeof channel>;
    ipcMain.handle(channel, (event, payload: unknown) =>
      dispatch(channel, handler, payload, event, isTrustedSender),
    );
  }
}
