import { Global, Module } from '@nestjs/common';
import { BeaconService } from './beacon.service';

/**
 * Public randomness beacon (ADR 0004). @Global so the crash, jackpot and lottery
 * engines can `@Optional()`-inject it without importing this module — the same
 * pattern as LiveModule. Absent (direct-engine tests), they keep the older
 * seed-only derivation.
 */
@Global()
@Module({
  providers: [BeaconService],
  exports: [BeaconService],
})
export class BeaconModule {}
