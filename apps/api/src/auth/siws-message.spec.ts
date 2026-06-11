import { describe, it, expect } from 'vitest';
import { SiwsService } from './siws.service';

/**
 * Golden-string lock for the canonical SIWS message (#12, bound per #37).
 * Drift breaks sign-in: `apps/web/src/hooks/use-siws-sign-in.ts` signs the
 * server-returned string verbatim and verify re-derives it byte-for-byte.
 * buildMessage is pure, so no Redis is needed here.
 */
describe('SiwsService.buildMessage', () => {
  const svc = new SiwsService(null as never);

  it('matches the exact multi-line bound format the frontend signs', () => {
    const { domain, uri, chainId } = SiwsService.binding();
    const msg = svc.buildMessage('Wa11etAddr', 'deadbeefcafe', '2026-06-10T00:00:00.000Z');
    expect(msg).toBe(
      `${domain} wants you to sign in with your Solana account:\n` +
        'Wa11etAddr\n' +
        '\n' +
        'Sign this message to authenticate. This will not trigger a transaction or cost any fees.\n' +
        '\n' +
        `URI: ${uri}\n` +
        'Version: 1\n' +
        `Chain ID: ${chainId}\n` +
        'Nonce: deadbeefcafe\n' +
        'Issued At: 2026-06-10T00:00:00.000Z',
    );
  });

  it('defaults bind to localhost dev values when env is unset', () => {
    const b = SiwsService.binding({});
    expect(b).toEqual({
      domain: 'localhost:3000',
      uri: 'http://localhost:3000',
      chainId: 'solana:devnet',
    });
  });
});
