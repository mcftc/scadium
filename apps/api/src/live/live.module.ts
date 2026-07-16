import { Global, Module } from '@nestjs/common';
import { LiveController } from './live.controller';
import { LiveFeedService } from './live-feed.service';
import { LiveFeedGateway } from './live-feed.gateway';

/**
 * Sitewide live-bet feed (#roadmap-4). @Global so every game module's settlement
 * site can `@Optional()`-inject `LiveFeedService` without importing this module
 * (PrismaModule uses the same pattern). Exports the service so producers publish;
 * the gateway owns the `/live` socket.
 */
@Global()
@Module({
  controllers: [LiveController],
  providers: [LiveFeedService, LiveFeedGateway],
  exports: [LiveFeedService],
})
export class LiveModule {}
