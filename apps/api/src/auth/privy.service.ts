import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';

/**
 * Identity Scadium trusts AFTER the Privy access token has been verified
 * server-side. Everything here is derived from Privy's API — never from the
 * client's request body. `email`/`walletAddress` are best-effort (may be
 * absent depending on which social provider the user linked).
 */
export interface VerifiedPrivyIdentity {
  /** Privy DID, e.g. `did:privy:abc123`. Stable per user; our `privyUserId`. */
  privyUserId: string;
  /** Linked Google/Apple email if present (lower-cased). */
  email: string | null;
  /** The provider used to source the email, for the User social column. */
  emailProvider: 'google' | 'apple' | 'email' | null;
  /** A linked Solana wallet address if the user has one (embedded or external). */
  solanaAddress: string | null;
}

/**
 * Server-side Privy access-token verification (Google/Apple social login, #203).
 *
 * SECURITY: the access token is an ES256-signed JWT minted by Privy. We verify
 * it cryptographically via `@privy-io/server-auth` and trust ONLY the claims it
 * returns — never any identity the client puts in the request body. The verified
 * `userId` (Privy DID) is the gate; the linked email/wallet are then fetched from
 * Privy's API so they can't be spoofed either.
 *
 * FAIL-CLOSED: `@privy-io/server-auth`'s `PrivyClient` requires the App Secret to
 * construct (both `verifyAuthToken` and `getUser` are authenticated against it).
 * The App Secret is NOT in the repo. If `PRIVY_APP_SECRET` (or
 * `NEXT_PUBLIC_PRIVY_APP_ID`/`PRIVY_APP_ID`) is missing we DO NOT fall back to a
 * "trust the client" path — `isConfigured()` is false and the endpoint returns
 * 503. Optionally `PRIVY_VERIFICATION_KEY` (the app's public ES256 PEM, copyable
 * from the Privy dashboard) is passed to `verifyAuthToken` to skip a per-request
 * API round-trip for the key.
 */
@Injectable()
export class PrivyService {
  private readonly logger = new Logger(PrivyService.name);
  private readonly appId: string | undefined;
  private readonly appSecret: string | undefined;
  private readonly verificationKey: string | undefined;
  private client: PrivyClient | null = null;

  constructor(private readonly config: ConfigService) {
    // App ID is shared with the browser bundle (NEXT_PUBLIC_*); also accept a
    // server-only alias.
    this.appId =
      this.config.get<string>('PRIVY_APP_ID') ??
      this.config.get<string>('NEXT_PUBLIC_PRIVY_APP_ID') ??
      undefined;
    this.appSecret = this.config.get<string>('PRIVY_APP_SECRET') ?? undefined;
    // Optional: a PEM verification key avoids a per-verify API call. Newlines may
    // arrive escaped from a single-line .env value.
    const rawKey = this.config.get<string>('PRIVY_VERIFICATION_KEY');
    this.verificationKey = rawKey ? rawKey.replace(/\\n/g, '\n') : undefined;
  }

  /** Whether server-side Privy verification can run. Both id AND secret needed. */
  isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  private getClient(): PrivyClient {
    if (!this.appId || !this.appSecret) {
      // 503 — operator must set PRIVY_APP_SECRET. We never fake-verify.
      throw new ServiceUnavailableException('Privy login is not configured');
    }
    if (!this.client) {
      this.client = new PrivyClient(this.appId, this.appSecret);
    }
    return this.client;
  }

  /**
   * Verify a Privy access token and resolve the trusted identity. Throws
   * 401 on an invalid/expired token (or a token minted for a different app),
   * 503 if Privy isn't configured server-side.
   */
  async verifyPrivyToken(accessToken: string): Promise<VerifiedPrivyIdentity> {
    const client = this.getClient();

    let claims: { userId: string; appId: string };
    try {
      claims = await client.verifyAuthToken(accessToken, this.verificationKey);
    } catch (err) {
      // Do NOT log the token. Log only that verification failed.
      this.logger.warn(`Privy token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid Privy token');
    }

    // Defence in depth: the SDK already checks `aud`, but assert the token was
    // minted for THIS app so a token from another Privy app can't authenticate.
    if (this.appId && claims.appId !== this.appId) {
      throw new UnauthorizedException('Privy token audience mismatch');
    }

    // Fetch the linked accounts from Privy (authenticated) — the email/wallet
    // come from Privy, never from the client.
    let email: string | null = null;
    let emailProvider: VerifiedPrivyIdentity['emailProvider'] = null;
    let solanaAddress: string | null = null;
    try {
      const user = await client.getUserById(claims.userId);
      if (user.google?.email) {
        email = user.google.email.toLowerCase();
        emailProvider = 'google';
      } else if (user.apple?.email) {
        email = user.apple.email.toLowerCase();
        emailProvider = 'apple';
      } else if (user.email?.address) {
        email = user.email.address.toLowerCase();
        emailProvider = 'email';
      }
      // Prefer a linked Solana wallet (embedded or external) for the address.
      if (user.wallet?.address && user.wallet.chainType === 'solana') {
        solanaAddress = user.wallet.address;
      } else {
        const solana = user.linkedAccounts.find(
          (a) => a.type === 'wallet' && a.chainType === 'solana',
        );
        if (solana && solana.type === 'wallet') solanaAddress = solana.address;
      }
    } catch (err) {
      // The token is valid; we just couldn't enrich. Proceed with id-only — the
      // user can still be provisioned and sign in.
      this.logger.warn(`Privy getUser failed for verified token: ${(err as Error).message}`);
    }

    return { privyUserId: claims.userId, email, emailProvider, solanaAddress };
  }
}
