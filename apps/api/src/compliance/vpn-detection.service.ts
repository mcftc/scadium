import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * VPN/proxy likelihood, gated behind `VPN_DETECTION_ENABLED` (#43). The guard
 * only consults this when `enabled`. The default `score()` returns 0 (fail-open)
 * until a provider (e.g. IPQualityScore / ipinfo) is wired — that call belongs
 * behind the flag and is intentionally a no-op here so play-money keeps working
 * without an external dependency or key.
 */
@Injectable()
export class VpnDetectionService {
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<string>('VPN_DETECTION_ENABLED') === 'true';
  }

  /** Block when the score is >= this (0..1). Configurable; defaults to 0.85. */
  get threshold(): number {
    const t = Number(this.config.get<string>('VPN_BLOCK_THRESHOLD'));
    return Number.isFinite(t) && t > 0 ? t : 0.85;
  }

  /** 0..1 VPN/proxy likelihood for an IP. Provider call is a flagged TODO. */
  async score(_ip: string | null): Promise<number> {
    return 0;
  }
}
