import { parseEnabledGames, isGameEnabled, type GameId } from '@scadium/shared';

/**
 * Which games this API instance serves.
 *
 * Read straight from `process.env`, not via `ConfigModule`: `AppModule`'s
 * `imports` array is evaluated at module load, before Nest's DI container
 * exists, so the value has to be available synchronously. This mirrors the
 * existing `demoBotsEnabled()` pattern in `games/bots/demo-bots.const.ts`.
 *
 * Gating happens at module registration. That is deliberate — a disabled game's
 * controllers and gateways are never registered, so its REST routes 404 and its
 * Socket.io namespace refuses connections. Hiding it only in the web navigation
 * would leave every endpoint live and bettable by anyone with the URL.
 *
 * Set `ENABLED_GAMES` to a comma-separated list of ids to change the roster;
 * unset falls back to the four in `DEFAULT_ENABLED_GAMES`.
 */
export const ENABLED_GAMES: readonly GameId[] = parseEnabledGames(process.env.ENABLED_GAMES);

/** Is this game served by this instance? */
export const gameEnabled = (id: string): boolean => isGameEnabled(id, ENABLED_GAMES);

/**
 * Include a game's Nest module only when that game is enabled.
 *
 * `imports: [...onlyIfEnabled('dice', DiceModule)]` — spreads to the module or
 * to nothing, which keeps the imports array readable and avoids a conditional
 * chain that every future game would have to be threaded through.
 */
export function onlyIfEnabled<T>(id: string, module: T): T[] {
  return gameEnabled(id) ? [module] : [];
}
