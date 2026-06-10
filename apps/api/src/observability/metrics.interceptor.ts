import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { httpRequestDuration, httpRequestsTotal } from './metrics.registry';

type ReqLike = { method?: string; route?: { path?: string }; originalUrl?: string; url?: string };
type ResLike = { statusCode?: number };

/**
 * HTTP latency/throughput metrics (#38). Global APP_INTERCEPTOR, HTTP-only
 * (gateway messages are not HTTP requests). Labels use the Express ROUTE
 * PATTERN (`/api/v1/crash/bet`, `:id` params unexpanded) — never the raw URL —
 * so cardinality stays bounded.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<ReqLike>();
    const res = context.switchToHttp().getResponse<ResLike>();
    const method = req.method ?? 'UNKNOWN';
    const stop = httpRequestDuration.startTimer();

    return next.handle().pipe(
      finalize(() => {
        const route = req.route?.path ?? 'unmatched';
        const status = String(res.statusCode ?? 0);
        stop({ method, route, status_code: status });
        httpRequestsTotal.inc({ method, route, status_code: status });
      }),
    );
  }
}
