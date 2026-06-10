import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * nestjs-pino configuration (#38): structured JSON logs with a correlation id
 * on every line, secrets redacted, and pretty output only in local dev.
 *
 * - Request id: reuse an incoming `x-request-id` (so a proxy/edge id correlates
 *   end-to-end) or generate one; ALWAYS echoed on the response so a user can
 *   quote it in a support ticket and we can grep the exact request.
 * - Redaction: bearer tokens and cookies never reach the log sink — a leaked
 *   log archive must not become a session-hijack corpus.
 * - /health and /metrics probes are scrape noise — not request-logged.
 */

/** Paths pino scrubs from every log line. Unit-locked in redaction.spec.ts. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

export function pinoParams(env = process.env): Params {
  const dev = env.NODE_ENV === 'development' || env.NODE_ENV === undefined;
  return {
    pinoHttp: {
      level: env.LOG_LEVEL ?? 'info',
      genReqId: requestId,
      redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
      autoLogging: {
        ignore: (req) => {
          const url = req.url ?? '';
          return url.startsWith('/health') || url.startsWith('/metrics');
        },
      },
      // Local dev only — production stays single-line JSON for log shippers.
      transport: dev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
