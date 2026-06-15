import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BLOCKED_COUNTRIES } from '@scadium/shared';

const DEV_SALT = 'scadium-dev-geo-salt-INSECURE';

type Headers = Record<string, string | string[] | undefined>;

/**
 * Resolves the request country from a trusted proxy/CDN header and decides
 * whether it is geo-blocked (#43). The blocklist is runtime-configurable via
 * `BLOCKED_COUNTRIES_OVERRIDE` (CSV) so legal can expand jurisdictions without a
 * deploy; it falls back to the shared `BLOCKED_COUNTRIES`. Raw IPs are only ever
 * exposed as a salted hash.
 */
@Injectable()
export class GeoService implements OnModuleInit {
  private readonly logger = new Logger(GeoService.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // A public/default salt makes the audit IP hash brute-forceable over the
    // IPv4 space → effectively reversible PII. REAL-MONEY GATE: GEO_IP_SALT must
    // be set to a private value before real money (tracked in #149).
    if (!this.config.get<string>('GEO_IP_SALT')?.trim()) {
      this.logger.error(
        'GEO_IP_SALT is not set — GeoCheck audit IP hashes use an INSECURE default and are reversible. Set GEO_IP_SALT before real money.',
      );
    }
  }

  private get countryHeader(): string {
    return (this.config.get<string>('GEO_COUNTRY_HEADER') ?? 'x-vercel-ip-country').toLowerCase();
  }

  /**
   * Resolved 2-letter ISO country (uppercase) from the trusted header, or null.
   * REAL-MONEY GATE: the deployment must guarantee a trusted proxy strips any
   * inbound copy of this header before injecting its own, else a client can
   * self-declare a country. Tracked in #149.
   */
  countryFromHeaders(headers: Headers): string | null {
    const raw = headers[this.countryHeader] ?? headers['cf-ipcountry'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== 'string') return null;
    const country = value.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : null;
  }

  /** Runtime-configurable blocklist (env override CSV or the shared default). */
  blockedCountries(): readonly string[] {
    const override = this.config.get<string>('BLOCKED_COUNTRIES_OVERRIDE');
    if (override && override.trim()) {
      return override
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
    }
    return BLOCKED_COUNTRIES;
  }

  isBlockedCountry(country: string | null): boolean {
    return !!country && this.blockedCountries().includes(country);
  }

  /** First hop of `x-forwarded-for`, else the socket IP. */
  clientIp(req: { headers: Headers; ip?: string }): string | null {
    const xff = req.headers['x-forwarded-for'];
    const value = Array.isArray(xff) ? xff[0] : xff;
    if (typeof value === 'string' && value.trim()) return value.split(',')[0]!.trim();
    return req.ip ?? null;
  }

  /** Salted SHA-256 — raw IPs are never persisted (#43). */
  hashIp(ip: string | null): string {
    const salt = this.config.get<string>('GEO_IP_SALT')?.trim() || DEV_SALT;
    return createHash('sha256').update(`${salt}:${ip ?? 'unknown'}`).digest('hex');
  }
}
