import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LicensingConfig {
  licensed: boolean;
  licenseNumber: string | null;
  regulator: string | null;
  jurisdiction: string | null;
}

/**
 * Licensing state, resolved fail-closed from env (#41). The product holds no
 * licence by default, so `licensed` is only true once a real licence number,
 * regulator and jurisdiction are ALL configured. The web footer gates its
 * 'Licensed & regulated' claim on this — asserting a regulatory licence we do
 * not hold is a legal misrepresentation, not just a trust problem.
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly config: ConfigService) {}

  private val(key: string): string {
    return (this.config.get<string>(key) ?? '').trim();
  }

  get licenseNumber(): string {
    return this.val('LICENSE_NUMBER');
  }

  get regulator(): string {
    return this.val('LICENSE_REGULATOR');
  }

  get jurisdiction(): string {
    return this.val('LICENSE_JURISDICTION');
  }

  /** Fail-closed: licensed only when all three fields are configured non-empty. */
  get licensed(): boolean {
    return !!(this.licenseNumber && this.regulator && this.jurisdiction);
  }

  /** Public config for the web; licence details are echoed only when licensed. */
  publicConfig(): LicensingConfig {
    const licensed = this.licensed;
    return {
      licensed,
      licenseNumber: licensed ? this.licenseNumber : null,
      regulator: licensed ? this.regulator : null,
      jurisdiction: licensed ? this.jurisdiction : null,
    };
  }
}
