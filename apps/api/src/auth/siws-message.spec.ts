import { describe, it, expect } from 'vitest';
import { SiwsService } from './siws.service';

/**
 * Golden-string lock for the canonical SIWS message (#12). The Redis refactor
 * must not drift this — `apps/web/src/hooks/use-siws-sign-in.ts` displays the
 * byte-identical string before the user signs, and verify re-derives it.
 * buildMessage is pure, so no Redis is needed here.
 */
describe('SiwsService.buildMessage', () => {
  const svc = new SiwsService(null as never);

  it('matches the exact multi-line format the frontend signs', () => {
    const msg = svc.buildMessage('Wa11etAddr', 'deadbeefcafe', '2026-06-10T00:00:00.000Z');
    expect(msg).toBe(
      'Scadium wants you to sign in with your Solana account:\n' +
        'Wa11etAddr\n' +
        '\n' +
        'Sign this message to authenticate. This will not trigger a transaction or cost any fees.\n' +
        '\n' +
        'Nonce: deadbeefcafe\n' +
        'Issued At: 2026-06-10T00:00:00.000Z',
    );
  });
});
