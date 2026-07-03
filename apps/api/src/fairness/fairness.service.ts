import { BadRequestException, Injectable } from '@nestjs/common';
import {
  crashPoint,
  coinflipResult,
  blackjackDeal,
  mineField,
  hiloSequence,
  towerTraps,
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
} from '@scadium/fair';
import { HILO, MINES, TOWER } from '@scadium/shared';

/**
 * Thin wrapper over @scadium/fair so game modules have a single DI-injectable
 * entry point for all fairness-related operations. Keeping the engine in a
 * separate package means the frontend can import the same code for the
 * /fairness verifier.
 */
@Injectable()
export class FairnessService {
  generateSeed(): string {
    return generateServerSeed();
  }

  generateClient(): string {
    return generateClientSeed();
  }

  commit(serverSeed: string): string {
    return commitServerSeed(serverSeed);
  }

  crash(serverSeed: string, clientSeed: string, nonce: number): number {
    return crashPoint(serverSeed, clientSeed, nonce);
  }

  coinflip(serverSeed: string, clientSeed: string, nonce: number) {
    return coinflipResult(serverSeed, clientSeed, nonce);
  }

  blackjack(serverSeed: string, clientSeed: string, nonce: number, count: number) {
    return blackjackDeal(serverSeed, clientSeed, nonce, count);
  }

  /**
   * Verify a user-submitted seed set against a reported result.
   * Used by the /fairness page to prove non-manipulation.
   */
  verify(params: {
    game: 'crash' | 'coinflip' | 'blackjack' | 'mines' | 'hilo' | 'tower';
    serverSeed: string;
    clientSeed: string;
    nonce: number;
    mines?: number;
  }) {
    const { game, serverSeed, clientSeed, nonce } = params;
    switch (game) {
      case 'crash':
        return { game, result: this.crash(serverSeed, clientSeed, nonce) };
      case 'coinflip':
        return { game, result: this.coinflip(serverSeed, clientSeed, nonce) };
      case 'blackjack':
        return { game, result: this.blackjack(serverSeed, clientSeed, nonce, 10) };
      case 'mines': {
        // The field is a prefix of one Fisher–Yates shuffle, so the wrong mine
        // count silently returns a plausible-looking subset that won't match the
        // round the player saw. Require the exact count rather than defaulting.
        if (params.mines == null) {
          throw new BadRequestException('mines is required to verify a mines round');
        }
        return {
          game,
          result: mineField(serverSeed, clientSeed, nonce, MINES.CELLS, params.mines),
        };
      }
      case 'hilo':
        // Base card + one per possible guess — the full committed sequence.
        return {
          game,
          result: hiloSequence(serverSeed, clientSeed, nonce, HILO.MAX_STEPS + 1),
        };
      case 'tower':
        return {
          game,
          result: towerTraps(
            serverSeed,
            clientSeed,
            nonce,
            TOWER.ROWS,
            TOWER.COLUMNS,
            TOWER.SAFE_PER_ROW,
          ),
        };
    }
  }
}
