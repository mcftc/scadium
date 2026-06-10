import { describe, expect, it } from 'vitest';

// Node (@scadium/fair) engine
import { crashPoint } from './crash';
import { coinflipResult } from './coinflip';
import { blackjackDeal } from './blackjack';
import { jackpotRoll, jackpotWinningTicket } from './jackpot';
import { lotteryDraw, lotteryFinalEntropy, padClientSeed32 } from './lottery';

// Browser (WebCrypto) engine — the EXACT file shipped to the client verifier.
// Runs here under Node's global WebCrypto (Node ≥ 19), so a divergence between
// the two independent implementations fails this test in CI.
import * as browser from '../../../apps/web/src/lib/fair-browser';

import golden from './__fixtures__/golden.json';

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const cardStr = (c: { rank: string; suit: string }) => `${c.rank}${c.suit}`;

describe('cross-implementation parity (golden vectors)', () => {
  for (const v of golden.vectors) {
    describe(`vector: ${v.label}`, () => {
      const slotBytes = hexToBytes(v.slotHashHex);
      const clientSeed32 = padClientSeed32(v.clientSeed);

      // ---- Node engine reproduces the committed fixture --------------------
      it('Node engine matches the golden vector', () => {
        expect(crashPoint(v.serverSeed, v.clientSeed, v.nonce)).toBe(v.crash);
        expect(coinflipResult(v.serverSeed, v.clientSeed, v.nonce)).toBe(v.coinflip);
        expect(blackjackDeal(v.serverSeed, v.clientSeed, v.nonce, 10).map(cardStr)).toEqual(
          v.blackjack,
        );
        expect(jackpotRoll(v.serverSeed, v.clientSeed, v.nonce).toString()).toBe(v.jackpotRoll);
        expect(
          jackpotWinningTicket(v.serverSeed, v.clientSeed, v.nonce, BigInt(v.jackpotPot)).toString(),
        ).toBe(v.jackpotTicket);

        expect(lotteryFinalEntropy(v.serverSeed, clientSeed32, slotBytes, v.nonce).toString('hex')).toBe(
          v.lottery.entropyHex,
        );
        const draw = lotteryDraw(v.serverSeed, clientSeed32, slotBytes, v.nonce);
        expect(draw.digits).toEqual(v.lottery.digits);
        expect(draw.encoded).toBe(v.lottery.encoded);
      });

      // ---- Browser WebCrypto engine reproduces the SAME fixture ------------
      it('browser WebCrypto engine matches the golden vector', async () => {
        expect(await browser.crashPoint(v.serverSeed, v.clientSeed, v.nonce)).toBe(v.crash);
        expect(await browser.coinflipResult(v.serverSeed, v.clientSeed, v.nonce)).toBe(v.coinflip);
        expect((await browser.blackjackDeal(v.serverSeed, v.clientSeed, v.nonce, 10)).map(cardStr)).toEqual(
          v.blackjack,
        );
        expect((await browser.jackpotRoll(v.serverSeed, v.clientSeed, v.nonce)).toString()).toBe(
          v.jackpotRoll,
        );

        const draw = await browser.lotteryDraw(v.serverSeed, v.clientSeed, v.slotHashHex, v.nonce);
        expect(draw.digits).toEqual(v.lottery.digits);
        expect(draw.encoded).toBe(v.lottery.encoded);
      });

      // ---- ...therefore Node and browser agree bit-for-bit ----------------
      it('Node and browser produce identical jackpot tickets', async () => {
        const nodeRoll = jackpotRoll(v.serverSeed, v.clientSeed, v.nonce);
        const browserRoll = await browser.jackpotRoll(v.serverSeed, v.clientSeed, v.nonce);
        expect(browserRoll).toBe(nodeRoll);
        // and the wide-modulus reduction over the same pot matches
        expect(browserRoll % BigInt(v.jackpotPot)).toBe(
          jackpotWinningTicket(v.serverSeed, v.clientSeed, v.nonce, BigInt(v.jackpotPot)),
        );
      });
    });
  }
});
