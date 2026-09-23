import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ALL_GAME_IDS, DEFAULT_ENABLED_GAMES } from '@scadium/shared';

/**
 * Game-gating coverage contract.
 *
 * Every game module must be registered through `onlyIfEnabled(...)`, never
 * unconditionally. A game wired in directly stays fully live — its REST routes
 * and Socket.io namespace keep serving — no matter what ENABLED_GAMES says, and
 * nothing else in the suite would notice, because the game works.
 *
 * This is a source scan in the same spirit as the engine / wager-gate /
 * referral coverage guards: it fails the moment a new game is added to the
 * graph without a gate, rather than waiting for someone to discover a disabled
 * game is still bettable by URL.
 *
 * Runs as a unit spec (no DB); cwd is `apps/api` under `vitest run src`.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const moduleNameFor = (id: string) =>
  ({ hilo: 'Hilo' })[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

describe('game gating coverage', () => {
  const appModule = read('src/app.module.ts');

  it.each(ALL_GAME_IDS)('registers %s through onlyIfEnabled', (id) => {
    expect(appModule).toContain(`onlyIfEnabled('${id}', ${moduleNameFor(id)}Module)`);
  });

  it.each(ALL_GAME_IDS)('never registers %s unconditionally', (id) => {
    const bare = new RegExp(`^\\s*${moduleNameFor(id)}Module,\\s*$`, 'm');
    expect(appModule).not.toMatch(bare);
  });

  it('gates PlatformModule the same way — a module imported there is registered there', () => {
    // Importing a game module in PlatformModule instantiates it, which would
    // re-register its controller and gateway behind the app-level gate's back.
    const platform = read('src/platform/platform.module.ts');
    for (const id of ['crash', 'coinflip', 'blackjack', 'jackpot']) {
      expect(platform).toContain(`onlyIfEnabled('${id}'`);
      expect(platform).not.toMatch(new RegExp(`^\\s*${moduleNameFor(id)}Module,\\s*$`, 'm'));
    }
  });

  it('keeps PlatformService tolerant of a missing game', () => {
    // Without @Optional() the API fails to BOOT when a game is switched off —
    // not 404 a route, fail to start.
    const svc = read('src/platform/platform.service.ts');
    for (const dep of ['crash', 'coinflip', 'blackjack', 'jackpot']) {
      expect(svc).toMatch(new RegExp(`@Optional\\(\\)\\s+private readonly ${dep}\\?`));
    }
  });

  it('ships the four games currently in scope by default', () => {
    expect([...DEFAULT_ENABLED_GAMES]).toEqual(['crash', 'coinflip', 'jackpot', 'lottery']);
  });
});
