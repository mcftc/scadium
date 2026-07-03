import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { mineField, hiloSequence, towerTraps } from '@scadium/fair';
import { MINES, HILO, TOWER } from '@scadium/shared';
import { FairnessService } from './fairness.service';

const SS = 'a'.repeat(64);
const CS = 'player-seed';
const NONCE = 7;

describe('FairnessService.verify', () => {
  const svc = new FairnessService();

  it('reproduces the mines field for the round’s exact mine count', () => {
    const res = svc.verify({ game: 'mines', serverSeed: SS, clientSeed: CS, nonce: NONCE, mines: 5 });
    expect(res).toEqual({ game: 'mines', result: mineField(SS, CS, NONCE, MINES.CELLS, 5) });
    // A different count yields a different field — so a silent default would lie.
    expect(res.result).not.toEqual(mineField(SS, CS, NONCE, MINES.CELLS, 3));
  });

  it('rejects a mines verification with no mine count instead of assuming one', () => {
    expect(() => svc.verify({ game: 'mines', serverSeed: SS, clientSeed: CS, nonce: NONCE })).toThrow(
      BadRequestException,
    );
  });

  it('reproduces the full hilo committed sequence', () => {
    const res = svc.verify({ game: 'hilo', serverSeed: SS, clientSeed: CS, nonce: NONCE });
    expect(res).toEqual({
      game: 'hilo',
      result: hiloSequence(SS, CS, NONCE, HILO.MAX_STEPS + 1),
    });
  });

  it('reproduces the tower trap layout', () => {
    const res = svc.verify({ game: 'tower', serverSeed: SS, clientSeed: CS, nonce: NONCE });
    expect(res).toEqual({
      game: 'tower',
      result: towerTraps(SS, CS, NONCE, TOWER.ROWS, TOWER.COLUMNS, TOWER.SAFE_PER_ROW),
    });
  });
});
