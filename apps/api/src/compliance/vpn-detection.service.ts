import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * VPN/proxy likelihood, gated behind `VPN_DETECTION_ENABLED` (#43). The guard
 * only consults this when `enabled`. A real provider (IPQualityScore) is wired
 * behind `VPN_PROVIDER_API_KEY` (#149); without a key `score()` returns 0 so
 * play-money keeps working without an external dependency. When real money is
 * on, the boot gate (assertRealMoneyReady) hard-requires a provider key if VPN
 * detection is enabled, and `score()` throws on a provider error so the guard
 * fails CLOSED rather than waving a VPN through.
 */
@Injectable()
export class VpnDetectionService implements OnModuleInit {
  private readonly logger = new Logger(VpnDetectionService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (this.enabled && !this.providerConfigured) {
      // Real money + this state is refused at boot by assertRealMoneyReady; in
      // play-money it is a no-op detector, so warn loudly that it does nothing.
      this.logger.warn(
        'VPN_DETECTION_ENABLED=true but VPN_PROVIDER_API_KEY is not set — VPN/proxy detection is INACTIVE (score always 0).',
      );
    }
  }

  get enabled(): boolean {
    return this.config.get<string>('VPN_DETECTION_ENABLED') === 'true';
  }

  /** True once a provider API key is configured (real detection is possible). */
  get providerConfigured(): boolean {
    return !!this.config.get<string>('VPN_PROVIDER_API_KEY')?.trim();
  }

  /** Block when the score is >= this (0..1). Configurable; defaults to 0.85. */
  get threshold(): number {
    const t = Number(this.config.get<string>('VPN_BLOCK_THRESHOLD'));
    return Number.isFinite(t) && t > 0 ? t : 0.85;
  }

  /**
   * 0..1 VPN/proxy likelihood for an IP via IPQualityScore. Returns 0 (inactive)
   * when no provider key is set. THROWS on a provider/network error so the guard
   * can fail closed for real money — callers must handle the rejection.
   */
  async score(ip: string | null): Promise<number> {
    const key = this.config.get<string>('VPN_PROVIDER_API_KEY')?.trim();
    if (!key || !ip) return 0;
    const url = `https://ipqualityscore.com/api/json/ip/${encodeURIComponent(key)}/${encodeURIComponent(ip)}?strictness=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`VPN provider HTTP ${res.status}`);
    const body = (await res.json()) as {
      success?: boolean;
      proxy?: boolean;
      vpn?: boolean;
      tor?: boolean;
      fraud_score?: number;
    };
    if (body.success === false) throw new Error('VPN provider returned success=false');
    // A definitive proxy/vpn/tor verdict is a hard 1.0; otherwise fall back to
    // the provider's 0..100 fraud score scaled to 0..1.
    if (body.proxy || body.vpn || body.tor) return 1;
    const fraud = typeof body.fraud_score === 'number' ? body.fraud_score : 0;
    return Math.max(0, Math.min(1, fraud / 100));
  }
}
