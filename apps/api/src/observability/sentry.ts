import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

/**
 * Sentry error tracking (#38), gated on SENTRY_DSN: without a DSN the app runs
 * exactly as before (no SDK init, zero overhead); with one, unhandled errors are
 * captured with the request id attached (SentryExceptionFilter). Exposed as a
 * tiny wrapper so the gate is unit-testable with a fake client.
 */
let initialized = false;

export interface SentryLike {
  init(options: { dsn: string; environment?: string; tracesSampleRate?: number }): void;
  captureException(error: unknown, context?: { tags?: Record<string, string> }): unknown;
}

export function initSentry(
  dsn: string | undefined = process.env.SENTRY_DSN,
  client: SentryLike = Sentry,
): boolean {
  if (!dsn || initialized) return initialized;
  client.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Error tracking only — tracing stays off until there's an OTel decision.
    tracesSampleRate: 0,
  });
  initialized = true;
  new Logger('Sentry').log('Sentry error tracking enabled');
  return true;
}

export function sentryEnabled(): boolean {
  return initialized;
}

/** Capture an exception with the request id as a searchable tag. No-op when disabled. */
export function captureException(
  error: unknown,
  requestId?: string,
  client: SentryLike = Sentry,
): void {
  if (!initialized) return;
  client.captureException(error, requestId ? { tags: { request_id: requestId } } : undefined);
}

/** Test hook — Sentry has process-global state; specs reset the local flag. */
export function resetSentryForTests(): void {
  initialized = false;
}
