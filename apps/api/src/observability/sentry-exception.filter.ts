import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { captureException } from './sentry';

/**
 * Global exception filter (#38): every UNEXPECTED error (anything that is not a
 * deliberate 4xx HttpException) is reported to Sentry tagged with the request's
 * correlation id, then handled by Nest's default filter as before. 4xx noise
 * (validation, auth, throttling) stays out of the error tracker.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const isClientError =
      exception instanceof HttpException && exception.getStatus() < 500;

    if (!isClientError && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<{ id?: string }>();
      captureException(exception, typeof req.id === 'string' ? req.id : undefined);
    }

    super.catch(exception, host);
  }
}
