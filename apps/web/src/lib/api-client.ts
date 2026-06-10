import { env } from '@/config/env';
import { useAuthStore } from '@/store/auth-store';

/**
 * Thin fetch wrapper that prefixes requests with the API base URL, attaches
 * the current JWT if present, and throws on non-2xx responses.
 *
 * Access token is read lazily from the auth store inside the request so a
 * fresh token is picked up after sign-in without re-creating the client.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  /** Internal: set on the single automatic retry after a token refresh (#35). */
  _retried?: boolean;
};

/**
 * Single-flight access-token refresh (#35): on a 401, rotate the refresh token
 * once and retry. Concurrent 401s share one in-flight refresh so we don't spam
 * `/auth/refresh` (which would trip reuse detection and revoke the session).
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const { refreshToken, walletAddress } = useAuthStore.getState();
    if (!refreshToken || !walletAddress) return false;
    try {
      const res = await fetch(`${env.apiUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!data.accessToken || !data.refreshToken) return false;
      useAuthStore.getState().setTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const url = `${env.apiUrl}/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: 'include',
  });

  const text = await res.text();
  const json = text ? safeParse(text) : undefined;

  if (!res.ok) {
    // A revoked/expired access token: try to rotate the refresh token ONCE and
    // replay the request with the new token. If that fails, drop the stale
    // session so the connect CTA shows instead of every call silently 401ing.
    if (res.status === 401 && opts.token && typeof window !== 'undefined' && !opts._retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return api<T>(path, { ...opts, token: useAuthStore.getState().accessToken, _retried: true });
      }
      useAuthStore.getState().clear();
    }
    const msg =
      (json as { message?: string } | undefined)?.message ??
      `API ${opts.method ?? 'GET'} ${path} failed: ${res.status}`;
    throw new ApiError(msg, res.status, json);
  }
  return json as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
