import type { IpcPayload, IpcResponses, SerializedError } from '@skillscope/shared';

export class ApiError extends Error {
  readonly code: SerializedError['code'];
  readonly hint: string | undefined;
  readonly details: string[] | undefined;

  constructor(error: SerializedError) {
    super(error.message);
    this.code = error.code;
    this.hint = error.hint;
    this.details = error.details;
  }
}

type Args<C extends keyof IpcResponses> = IpcPayload<C> extends undefined ? [] : [IpcPayload<C>];

/** Call the main process and unwrap the Result, throwing ApiError on failure. */
export async function call<C extends keyof IpcResponses>(
  channel: C,
  ...payload: Args<C>
): Promise<IpcResponses[C]> {
  const result = await window.skillscope.invoke(channel, ...payload);
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
}

export function errorText(error: unknown): { message: string; hint?: string } {
  if (error instanceof ApiError)
    return error.hint ? { message: error.message, hint: error.hint } : { message: error.message };
  return { message: error instanceof Error ? error.message : String(error) };
}
