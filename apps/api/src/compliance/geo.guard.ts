import { CanActivate, ExecutionContext, HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ComplianceService } from './compliance.service';
import { GeoService } from './geo.service';
import { VpnDetectionService } from './vpn-detection.service';

// 451 Unavailable For Legal Reasons — the right status for a geo/legal block.
const HTTP_LEGAL = 451;

/**
 * Global geo/VPN guard (#43, hardened #149). Blocks requests from a blocked
 * country and, when `VPN_DETECTION_ENABLED`, from IPs scoring above the VPN
 * threshold. Every BLOCK is written to the `GeoCheck` audit trail (hashed IP).
 *
 * Real-money behaviour (`REAL_MONEY_ENABLED`): the guard fails CLOSED — a
 * request whose region cannot be positively verified (no/untrusted geo header,
 * or a VPN check that errors) is BLOCKED, not waved through. Geo headers are
 * only trusted from a proxy presenting `GEO_PROXY_SECRET`, so a direct-to-origin
 * caller cannot self-declare a permitted country. In the play-money demo the
 * guard fails OPEN on an unknown region so it keeps working behind a plain CDN.
 */
@Injectable()
export class GeoGuard implements CanActivate {
  private readonly logger = new Logger(GeoGuard.name);

  constructor(
    private readonly geo: GeoService,
    private readonly vpn: VpnDetectionService,
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Global guard: only enforce on HTTP. WebSocket/RPC contexts have no
    // switchToHttp() request — touching req.headers there would crash the
    // Socket.io gateways (crash/coinflip/chat), same as HttpThrottlerGuard skips.
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const realMoney = this.compliance.realMoneyEnabled;
    // Only trust geo headers proven to come through the trusted proxy (#149);
    // an untrusted request is treated as an unknown region.
    const trusted = this.geo.headersAreTrusted(headers);
    const country = trusted ? this.geo.countryFromHeaders(headers) : null;
    const ip = this.geo.clientIp({ headers, ip: req.ip });
    const path = req.originalUrl ?? req.url ?? null;

    // Fail-closed (real money): we must positively verify a permitted region.
    if (realMoney && country === null) {
      await this.audit(ip, country, null, false, path);
      throw new HttpException('Your region could not be verified', HTTP_LEGAL);
    }

    if (this.geo.isBlockedCountry(country)) {
      await this.audit(ip, country, null, false, path);
      throw new HttpException('Access from your region is restricted', HTTP_LEGAL);
    }

    if (this.vpn.enabled) {
      let score: number;
      try {
        score = await this.vpn.score(ip);
      } catch (e) {
        // Provider/network error. Fail CLOSED for real money (don't wave a
        // possible VPN through); fail open in the play-money demo.
        this.logger.warn(
          `VPN provider check failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        if (realMoney) {
          await this.audit(ip, country, null, false, path);
          throw new HttpException('VPN/proxy check is temporarily unavailable', HTTP_LEGAL);
        }
        return true;
      }
      if (score >= this.vpn.threshold) {
        await this.audit(ip, country, score, false, path);
        throw new HttpException('Access via VPN/proxy is restricted', HTTP_LEGAL);
      }
    }

    return true;
  }

  /** Best-effort audit — never let an audit failure mask the block decision. */
  private async audit(
    ip: string | null,
    country: string | null,
    vpnScore: number | null,
    allowed: boolean,
    path: string | null,
  ): Promise<void> {
    try {
      await this.prisma.geoCheck.create({
        data: { ipHash: this.geo.hashIp(ip), country, vpnScore, allowed, path },
      });
    } catch (e) {
      this.logger.warn(
        `GeoCheck audit write failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
