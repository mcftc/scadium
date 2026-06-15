import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BLOCKED_COUNTRIES } from '@scadium/shared';

const DEV_SALT = 'scadium-dev-geo-salt-INSECURE';
// Salts that are public knowledge (shipped in .env.example / the dev default) —
// using one makes the audit IP hash reversible, so they don't count as "set".
const INSECURE_SALTS = new Set(['change-me-geo-salt', DEV_SALT]);
const MIN_SALT_LENGTH = 32;

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
    // IPv4 space → effectively reversible PII. Real money hard-requires it via
    // assertRealMoneyReady (#149); here we just warn for the play-money demo.
    if (!this.ipSaltConfigured) {
      this.logger.error(
        'GEO_IP_SALT is not set — GeoCheck audit IP hashes use an INSECURE default and are reversible. Set GEO_IP_SALT before real money.',
      );
    }
  }

  /**
   * True once a *private*, sufficiently-long IP-hash salt is configured. A known
   * placeholder/dev salt or a short one does NOT count — it would leave the audit
   * hash reversible. Real money refuses to boot unless this is true.
   */
  get ipSaltConfigured(): boolean {
    const v = this.config.get<string>('GEO_IP_SALT')?.trim() ?? '';
    return v.length >= MIN_SALT_LENGTH && !INSECURE_SALTS.has(v);
  }

  /** Shared secret a trusted proxy injects to prove geo headers are authentic. */
  private get proxySecret(): string {
    return this.config.get<string>('GEO_PROXY_SECRET')?.trim() ?? '';
  }

  /** True once a trusted-proxy secret is configured (required for real money). */
  get proxySecretConfigured(): boolean {
    return this.proxySecret.length > 0;
  }

  /**
   * Whether the request's geo headers can be trusted (#149). The geo/IP headers
   * are only as trustworthy as the proxy that sets them — a direct-to-origin
   * caller can self-declare any country. When `GEO_PROXY_SECRET` is configured,
   * the trusted proxy must echo it in `x-geo-proxy-secret`; a missing/mismatched
   * secret means the request did NOT come through the proxy, so its geo headers
   * are untrusted (the guard then treats the country as unknown → fail-closed
   * for real money). With no secret configured (play-money demo) headers are
   * trusted as-is, preserving the existing behaviour.
   */
  headersAreTrusted(headers: Headers): boolean {
    const secret = this.proxySecret;
    if (!secret) return true;
    const raw = headers['x-geo-proxy-secret'];
    const provided = (Array.isArray(raw) ? raw[0] : raw) ?? '';
    // Compare HMACs (always 32 bytes) so the compare is constant-time AND leaks
    // no information about the secret's length (a raw length check would).
    const a = createHmac('sha256', secret).update(provided).digest();
    const b = createHmac('sha256', secret).update(secret).digest();
    return timingSafeEqual(a, b);
  }

  private get countryHeader(): string {
    return (this.config.get<string>('GEO_COUNTRY_HEADER') ?? 'x-vercel-ip-country').toLowerCase();
  }

  /**
   * Resolved 2-letter ISO country (uppercase) from the trusted header, or null.
   * The deployment must guarantee a trusted proxy strips any inbound copy of
   * this header before injecting its own, else a client can self-declare a
   * country — enforced via `headersAreTrusted` + `GEO_PROXY_SECRET` (#149); see
   * docs/runbooks/trusted-proxy.md.
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
    return createHash('sha256')
      .update(`${salt}:${ip ?? 'unknown'}`)
      .digest('hex');
  }
}
