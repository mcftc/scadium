import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { DiceService } from '../dice/dice.service';
import { LimboService } from '../limbo/limbo.service';
import { WheelService } from '../wheel/wheel.service';
import { PlinkoService } from '../plinko/plinko.service';
import { MinesService } from '../mines/mines.service';
import { HiloService } from '../hilo/hilo.service';
import { TowerService } from '../tower/tower.service';
import { CoinflipService } from '../coinflip/coinflip.service';
import { CrashService } from '../crash/crash.service';
import { DEMO_BOTS, DEMO_BOT_BALANCE, demoBotsEnabled, type DemoBot } from './demo-bots.const';

/**
 * Universal demo-bot driver (`DEMO_BOTS=1`). Generalises the jackpot demo-bot
 * concept (`jackpot.engine.ts`) so EVERY game has background activity and is
 * "always playable" in a local/solo demo, without a human online.
 *
 * Design choices:
 *  - Bots place bets through the SAME public service entrypoints a human hits
 *    (`*.play()`, `coinflip.create/join`, `crash.placeBet`), so fairness, the
 *    RG guard, settlement and the proof-of-wager accrual are exercised
 *    identically — bots cannot skew the provably-fair outcome.
 *  - Services are resolved lazily via `ModuleRef` (`strict: false`), so this
 *    module does NOT need to import every game module. That sidesteps the
 *    app-boot module-graph fragility (a guard/provider needing its module
 *    imported) and keeps the dependency one-directional.
 *  - Every driver is wrapped in try/catch and every timer is `unref()`'d, so a
 *    bot failure can never crash or hold the API process open.
 *
 * Jackpot already drives its own bots inside its engine; this service covers the
 * other games. NEVER enable in a funded/mainnet config.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotService.name);
  private timers: NodeJS.Timeout[] = [];

  // ~0.01–0.5 SOL, comfortably inside every game's [0.001, 100] SOL range.
  private static readonly MIN_LAMPORTS = 10_000_000n;
  private static readonly MAX_LAMPORTS = 500_000_000n;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!demoBotsEnabled()) return;
    try {
      await this.ensureBots();
    } catch (e) {
      this.logger.error(`demo bots init failed (disabling drivers): ${String(e)}`);
      return;
    }
    // A general tick that drives a random instant/stateful/coinflip action, plus
    // a faster crash ticker that only bets during the betting window.
    this.schedule(() => void this.driveRandom(), 4_000);
    this.schedule(() => void this.driveCrash(), 2_500);
    this.logger.log(`demo bots driving ${DEMO_BOTS.length} players across all games`);
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private schedule(fn: () => void, periodMs: number): void {
    // Jitter the first fire so the games don't all settle on the same tick.
    const timer = setInterval(fn, periodMs + Math.floor(Math.random() * 1_000));
    timer.unref?.();
    this.timers.push(timer);
  }

  /** Idempotently provision the demo bot users with a big play balance. */
  async ensureBots(): Promise<void> {
    let ready = 0;
    for (const bot of DEMO_BOTS) {
      try {
        await this.prisma.user.upsert({
          where: { id: bot.id },
          update: { playBalanceLamports: DEMO_BOT_BALANCE },
          create: {
            id: bot.id,
            username: bot.username,
            walletAddress: bot.wallet,
            refCode: `bot${bot.id.slice(-4)}`,
            playBalanceLamports: DEMO_BOT_BALANCE,
          },
        });
        ready++;
      } catch (e) {
        this.logger.warn(`demo bot ${bot.username} not provisioned: ${String(e)}`);
      }
    }
    this.logger.log(`demo bots ready (${ready}/${DEMO_BOTS.length})`);
  }

  private pickBot(): DemoBot {
    return DEMO_BOTS[Math.floor(Math.random() * DEMO_BOTS.length)]!;
  }

  private randAmount(): bigint {
    const span = BotService.MAX_LAMPORTS - BotService.MIN_LAMPORTS;
    return BotService.MIN_LAMPORTS + BigInt(Math.floor(Math.random() * Number(span)));
  }

  /** Resolve a game service without importing its module (already in AppModule). */
  private svc<T>(type: new (...args: never[]) => T): T | null {
    try {
      return this.moduleRef.get(type, { strict: false });
    } catch {
      return null;
    }
  }

  /** Drive one random non-crash game so each game keeps showing live bets. */
  private async driveRandom(): Promise<void> {
    const actions = [
      () => this.driveDice(),
      () => this.driveLimbo(),
      () => this.driveWheel(),
      () => this.drivePlinko(),
      () => this.driveMines(),
      () => this.driveHilo(),
      () => this.driveTower(),
      () => this.driveCoinflip(),
    ];
    const action = actions[Math.floor(Math.random() * actions.length)]!;
    try {
      await action();
    } catch (e) {
      this.logger.debug?.(`bot action skipped: ${String(e)}`);
    }
  }

  private async driveDice(): Promise<void> {
    const dice = this.svc(DiceService);
    if (!dice) return;
    await dice.play({ userId: this.pickBot().id, amountLamports: this.randAmount(), target: 50 });
  }

  private async driveLimbo(): Promise<void> {
    const limbo = this.svc(LimboService);
    if (!limbo) return;
    await limbo.play({ userId: this.pickBot().id, amountLamports: this.randAmount(), target: 2 });
  }

  private async driveWheel(): Promise<void> {
    const wheel = this.svc(WheelService);
    if (!wheel) return;
    await wheel.play({ userId: this.pickBot().id, amountLamports: this.randAmount() });
  }

  private async drivePlinko(): Promise<void> {
    const plinko = this.svc(PlinkoService);
    if (!plinko) return;
    await plinko.play({ userId: this.pickBot().id, amountLamports: this.randAmount(), rows: 16 });
  }

  private async driveMines(): Promise<void> {
    const mines = this.svc(MinesService);
    if (!mines) return;
    const userId = this.pickBot().id;
    const round = await mines.start({ userId, amountLamports: this.randAmount(), mines: 3 });
    const { roundId } = round as { roundId?: string };
    if (!roundId) return;
    await mines.pick({ userId, roundId, cell: Math.floor(Math.random() * 25) });
    await mines.cashout({ userId, roundId }).catch(() => undefined); // may already be busted
  }

  private async driveHilo(): Promise<void> {
    const hilo = this.svc(HiloService);
    if (!hilo) return;
    const userId = this.pickBot().id;
    const round = await hilo.start({ userId, amountLamports: this.randAmount() });
    const { roundId } = round as { roundId?: string };
    if (!roundId) return;
    await hilo.guess({ userId, roundId, direction: Math.random() < 0.5 ? 'higher' : 'lower' });
    await hilo.cashout({ userId, roundId }).catch(() => undefined); // may already have lost
  }

  private async driveTower(): Promise<void> {
    const tower = this.svc(TowerService);
    if (!tower) return;
    const userId = this.pickBot().id;
    const round = await tower.start({ userId, amountLamports: this.randAmount() });
    const { roundId } = round as { roundId?: string };
    if (!roundId) return;
    await tower.pick({ userId, roundId, column: Math.floor(Math.random() * 3) });
    await tower.cashout({ userId, roundId }).catch(() => undefined);
  }

  private async driveCoinflip(): Promise<void> {
    const coinflip = this.svc(CoinflipService);
    if (!coinflip) return;
    // Prefer joining an open flip created by another bot so it resolves; else
    // create a fresh open flip for the next bot (or a human) to join.
    const open = (await coinflip.listOpen(10).catch(() => [])) as Array<{
      id: string;
      creator?: { id?: string };
    }>;
    const joiner = this.pickBot();
    const joinable = open.find((g) => g.creator?.id !== joiner.id);
    if (joinable) {
      await coinflip.join({ userId: joiner.id, gameId: joinable.id });
      return;
    }
    await coinflip.create({
      userId: this.pickBot().id,
      side: Math.random() < 0.5 ? 'heads' : 'tails',
      amountLamports: this.randAmount(),
    });
  }

  /** Place a crash bet, but ONLY during the betting window (engine throws otherwise). */
  private async driveCrash(): Promise<void> {
    if (!demoBotsEnabled()) return;
    const crash = this.svc(CrashService);
    if (!crash) return;
    try {
      if (crash.snapshot().phase !== 'waiting') return;
      const autoCashout = 1.2 + Math.random() * 3; // bots cash out between 1.2x and 4.2x
      await crash.placeBet({
        userId: this.pickBot().id,
        amountLamports: this.randAmount(),
        autoCashout: Number(autoCashout.toFixed(2)),
      });
    } catch (e) {
      this.logger.debug?.(`crash bot bet skipped: ${String(e)}`);
    }
  }
}
