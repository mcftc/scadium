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
};

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
    // An expired/invalid JWT otherwise leaves the UI looking signed-in while
    // every authed call 401s — drop the stale session so the connect CTA shows.
    if (res.status === 401 && opts.token && typeof window !== 'undefined') {
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
