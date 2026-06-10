import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Single-writer leader election over Redis (issue #13 / #85). Each game engine
 * owns one election on a key like `lock:engine:crash`; only the lock holder
 * advances the round loop, so N API replicas run exactly ONE loop per game. With
 * a single replica it is a behavioral no-op — that replica always wins.
 *
 * The lock is a `SET key <instanceId> NX PX <ttl>` token renewed at ttl/2 via a
 * compare-and-extend Lua script (so we only ever renew a lock we still hold). If
 * a renewal finds the lock gone or stolen, leadership drops immediately and the
 * engine stops scheduling; another replica acquires within one ttl.
 */
export class LeaderElection {
  private readonly instanceId: string;
  private leader = false;
  private timer: NodeJS.Timeout | null = null;
  private onChange?: (isLeader: boolean) => void;

  constructor(
    private readonly redis: Redis,
    private readonly key: string,
    private readonly ttlMs = 10_000,
    instanceId?: string,
  ) {
    this.instanceId = instanceId ?? `${process.pid}:${randomUUID()}`;
  }

  isLeader(): boolean {
    return this.leader;
  }

  /** One acquire-or-renew cycle. Returns current leadership. Never throws. */
  async tick(): Promise<boolean> {
    try {
      if (this.leader) {
        // Compare-and-extend: only renew if we still hold the token.
        const renew =
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
        const ok = await this.redis.eval(renew, 1, this.key, this.instanceId, String(this.ttlMs));
        this.leader = ok === 1;
        if (!this.leader) await this.acquire(); // lost it — try to take it straight back
      } else {
        await this.acquire();
      }
    } catch {
      this.leader = false; // Redis hiccup → relinquish; a healthy replica takes over
    }
    return this.leader;
  }

  private async acquire(): Promise<void> {
    const res = await this.redis.set(this.key, this.instanceId, 'PX', this.ttlMs, 'NX');
    this.leader = res === 'OK';
  }

  /**
   * Begin periodic acquire/renew. `onChange(isLeader)` fires on every leadership
   * transition (e.g. start the loop when elected, stop scheduling when lost).
   */
  start(onChange?: (isLeader: boolean) => void, intervalMs = Math.max(1000, Math.floor(this.ttlMs / 2))): void {
    this.onChange = onChange;
    const run = async () => {
      const was = this.leader;
      const now = await this.tick();
      if (now !== was) this.onChange?.(now);
    };
    void run();
    this.timer = setInterval(() => void run(), intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const release =
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    await this.redis.eval(release, 1, this.key, this.instanceId).catch(() => undefined);
    this.leader = false;
  }
}
