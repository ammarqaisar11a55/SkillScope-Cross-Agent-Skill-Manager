import { session, shell, type WebContents } from 'electron';

/**
 * Content Security Policy for the privileged renderer. No remote scripts, no eval, no remote
 * connections: all data reaches the renderer through the typed preload bridge.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DEV_CONNECT = "connect-src 'self' ws://localhost:* http://localhost:*";

export function applySessionSecurity(isDev: boolean): void {
  const ses = session.defaultSession;
  const csp = isDev
    ? CONTENT_SECURITY_POLICY.replace("connect-src 'self'", DEV_CONNECT)
    : CONTENT_SECURITY_POLICY;

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  // The renderer never needs camera, microphone, notifications, geolocation, etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/** Only http(s) links are ever handed to the OS browser; everything else is dropped. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function hardenWebContents(
  contents: WebContents,
  isAllowedUrl: (url: string) => boolean,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
