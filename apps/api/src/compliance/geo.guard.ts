import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { GeoService } from './geo.service';
import { VpnDetectionService } from './vpn-detection.service';

// 451 Unavailable For Legal Reasons — the right status for a geo/legal block.
const HTTP_LEGAL = 451;

/**
 * Global geo/VPN guard (#43). Blocks requests from a blocked country (always)
 * and, when `VPN_DETECTION_ENABLED`, from IPs scoring above the VPN threshold.
 * Fail-open when the country cannot be resolved (no trusted geo header) so the
 * play-money demo keeps working behind a CDN that doesn't inject geo. Every
 * BLOCK is written to the `GeoCheck` audit trail (hashed IP only).
 *
 * REAL-MONEY GATE: fail-open + header-trust must become fail-closed / strictly
 * CDN-enforced before real money — a direct-to-origin caller bypasses geo.
 * Tracked in #149.
 */
@Injectable()
export class GeoGuard implements CanActivate {
  private readonly logger = new Logger(GeoGuard.name);

  constructor(
    private readonly geo: GeoService,
    private readonly vpn: VpnDetectionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Global guard: only enforce on HTTP. WebSocket/RPC contexts have no
    // switchToHttp() request — touching req.headers there would crash the
    // Socket.io gateways (crash/coinflip/chat), same as HttpThrottlerGuard skips.
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const country = this.geo.countryFromHeaders(headers);
    const ip = this.geo.clientIp({ headers, ip: req.ip });
    const path = req.originalUrl ?? req.url ?? null;

    if (this.geo.isBlockedCountry(country)) {
      await this.audit(ip, country, null, false, path);
      throw new HttpException('Access from your region is restricted', HTTP_LEGAL);
    }

    if (this.vpn.enabled) {
      const score = await this.vpn.score(ip);
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
      this.logger.warn(`GeoCheck audit write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
