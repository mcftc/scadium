import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Swagger gating (#38): /docs leaks the full API surface, so it is OFF in
 * production unless explicitly re-enabled (DOCS_ENABLED=true — for a staging
 * box behind its own auth/firewall). Shared by main.ts and the test harness so
 * the gate itself is what e2e exercises.
 */
export function docsEnabled(env = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return env.DOCS_ENABLED === 'true';
}

export function setupSwagger(app: INestApplication, env = process.env): boolean {
  if (!docsEnabled(env)) return false;
  const config = new DocumentBuilder()
    .setTitle('Scadium API')
    .setDescription('Non-custodial, provably-fair Solana casino backend')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
  return true;
}
