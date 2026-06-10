import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis/redis-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
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

  // API prefix — health probes stay unprefixed at /health, /health/live, /health/ready.
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Scadium API')
    .setDescription('Non-custodial, provably-fair Solana casino backend')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`🎰 Scadium API running on http://localhost:${port}`);
  logger.log(`📚 Swagger docs: http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Failed to start API:', err);
  process.exit(1);
});
