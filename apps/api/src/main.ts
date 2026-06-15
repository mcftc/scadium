import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis/redis-io.adapter';
import { initSentry } from './observability/sentry';
import { setupSwagger } from './observability/swagger';
import { ComplianceService } from './compliance/compliance.service';
import { GeoService } from './compliance/geo.service';
import { VpnDetectionService } from './compliance/vpn-detection.service';
import { KycService } from './kyc/kyc.service';
import { assertRealMoneyReady } from './compliance/real-money-gate';

async function bootstrap() {
  // Error tracking first so even bootstrap failures can be captured (#38).
  // No SENTRY_DSN → no-op.
  initSentry();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Flush the buffered bootstrap logs through pino (structured JSON + request-id
  // correlation + secret redaction; see logging/pino.config.ts) (#38).
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Real-money boot gate (#49): refuse to start with REAL_MONEY_ENABLED unless a
  // licence is held and KYC is on (geoblocking is always enforced). Fail-closed.
  const compliance = app.get(ComplianceService);
  const kyc = app.get(KycService);
  const geo = app.get(GeoService);
  const vpn = app.get(VpnDetectionService);
  assertRealMoneyReady({
    realMoneyEnabled: compliance.realMoneyEnabled,
    licensed: compliance.licensed,
    kycEnabled: kyc.enabled,
    geoIpSaltSet: geo.ipSaltConfigured,
    geoProxySecretSet: geo.proxySecretConfigured,
    vpnDetectionEnabled: vpn.enabled,
    vpnProviderConfigured: vpn.providerConfigured,
  });

  // Behind Caddy/any reverse proxy: honor X-Forwarded-For so rate-limiting and logging
  // see the real client IP instead of the proxy's. Required for per-IP throttling.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Cross-pod Socket.io broadcast (#87): with ≥2 API replicas behind leader
  // election, the leader's emits must reach clients on every pod. Wire the Redis
  // adapter when REDIS_URL is set (must happen before gateways bind / listen).
  if (process.env.REDIS_URL) {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(process.env.REDIS_URL);
    app.useWebSocketAdapter(redisIoAdapter);
  }

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  // API prefix — health probes and the Prometheus scrape stay unprefixed.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/live', 'health/ready', 'metrics'],
  });

  // Swagger — gated: OFF in production unless DOCS_ENABLED=true (#38).
  const docs = setupSwagger(app);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`🎰 Scadium API running on http://localhost:${port}`);
  if (docs) logger.log(`📚 Swagger docs: http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  // Pino may not exist yet if AppModule failed to build — plain stderr is the
  // only reliable sink for a boot crash.
  console.error('Failed to start API:', err);
  process.exit(1);
});
