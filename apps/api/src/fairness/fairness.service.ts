import { Injectable } from '@nestjs/common';
import {
  crashPoint,
  coinflipResult,
  blackjackDeal,
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
} from '@scadium/fair';

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
    game: 'crash' | 'coinflip' | 'blackjack';
    serverSeed: string;
    clientSeed: string;
    nonce: number;
  }) {
    const { game, serverSeed, clientSeed, nonce } = params;
    switch (game) {
      case 'crash':
        return { game, result: this.crash(serverSeed, clientSeed, nonce) };
      case 'coinflip':
        return { game, result: this.coinflip(serverSeed, clientSeed, nonce) };
      case 'blackjack':
        return { game, result: this.blackjack(serverSeed, clientSeed, nonce, 10) };
    }
  }
}
