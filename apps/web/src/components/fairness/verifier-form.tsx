'use client';

import { useEffect, useState } from 'react';
import { Check, X, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  crashPoint,
  coinflipResult,
  reproduceHand,
  reproduceRound,
  lotteryDraw,
  jackpotRoll,
  crashPointFromEntropy,
  jackpotTicketFromEntropy,
  jackpotWinnerIndex,
  fetchBeaconRandomness,
  diceRoll,
  limboResult,
  kenoDraw,
  wheelSpin,
  plinkoDrop,
  mineField,
  hiloSequence,
  towerTraps,
  verifyCommit,
  type DealLogEntry,
} from '@/lib/fair-browser';
import { api } from '@/lib/api-client';
import {
  FAIR_BEACON,
  beaconRoundUrl,
  DICE,
  LIMBO,
  WHEEL_SEGMENTS,
  PLINKO,
  MINES,
  HILO,
  TOWER,
  plinkoPayouts,
  diceMultiplier,
  wheelMultiplier,
  KENO,
  type Card,
  type DiceMode,
} from '@scadium/shared';

type Game =
  | 'crash'
  | 'coinflip'
  | 'blackjack'
  | 'lottery'
  | 'jackpot'
  | 'dice'
  | 'limbo'
  | 'plinko'
  | 'wheel'
  | 'mines'
  | 'hilo'
  | 'tower'
  | 'keno';

const GAMES: Game[] = [
  'crash',
  'coinflip',
  'blackjack',
  'lottery',
  'jackpot',
  'dice',
  'limbo',
  'plinko',
  'wheel',
  'mines',
  'hilo',
  'tower',
  'keno',
];

const HILO_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const HILO_SUITS = ['♠', '♥', '♦', '♣'];

interface Result {
  game: Game;
  output: string;
  commitOk: boolean | null;
  /** Further independent checks (beacon value, winning ticket, winner), each pass/fail. */
  checks: { label: string; ok: boolean }[];
}

/** A settled jackpot round as GET /jackpot/rounds/:id serves it. */
interface JackpotRoundDetail {
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  totalLamports: string;
  winningTicket: string | null;
  winnerPlayerId: string | null;
  beaconRound: string | null;
  entropy: string | null;
  ranges: {
    playerId: string;
    player: string;
    amountLamports: string;
    start: string;
    end: string;
  }[];
}

/** Games whose result folds in a public drand beacon value (ADR 0004). */
const BEACON_GAMES: Game[] = ['crash', 'lottery', 'jackpot'];

/**
 * Client-side verifier. Uses WebCrypto directly — the server never sees
 * the seeds, the computation is auditable, and any mismatch is the user's
 * proof that something was tampered with.
 */
export function VerifierForm() {
  const [game, setGame] = useState<Game>('crash');
  const [serverSeed, setServerSeed] = useState('');
  const [clientSeed, setClientSeed] = useState('');
  const [nonce, setNonce] = useState('0');
  const [commitHash, setCommitHash] = useState('');
  const [slotHash, setSlotHash] = useState(''); // lottery only — draw-time entropy
  const [beaconRound, setBeaconRound] = useState(''); // crash/lottery/jackpot — drand round (ADR 0004)
  const [jackpotRoundId, setJackpotRoundId] = useState(''); // jackpot — settled round to check
  const [dealLog, setDealLog] = useState(''); // blackjack only — round deal order / seat deck indices
  const [target, setTarget] = useState(''); // dice / limbo only — chosen target (optional)
  const [diceMode, setDiceMode] = useState<DiceMode>('under'); // dice only — win rule
  const [rows, setRows] = useState('16'); // plinko only — peg rows
  const [mineCount, setMineCount] = useState('3'); // mines only — the round's mine count
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill from a deep link, e.g. the crash "Verify this round" button:
  // /fairness?game=crash&clientSeed=…&nonce=…&commit=…&serverSeed=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get('game');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot client-only prefill from window.location query params on mount (the deep-link "Verify this round" flow); seeding form state here is intentional and runs once.
    if (g && (GAMES as string[]).includes(g)) setGame(g as Game);
    const ss = q.get('serverSeed');
    const cs = q.get('clientSeed');
    const n = q.get('nonce');
    const commit = q.get('commit');
    const sh = q.get('slotHash');
    const tg = q.get('target');
    const rw = q.get('rows');
    const md = q.get('mode');
    if (ss) setServerSeed(ss);
    if (cs) setClientSeed(cs);
    if (n) setNonce(n);
    if (commit) setCommitHash(commit);
    if (sh) setSlotHash(sh);
    if (tg) setTarget(tg);
    if (rw) setRows(rw);
    if (md === 'under' || md === 'over') setDiceMode(md);
    const mn = q.get('mines');
    if (mn) setMineCount(mn);
    const br = q.get('beaconRound');
    if (br) setBeaconRound(br);
    const rid = q.get('round');
    if (rid) setJackpotRoundId(rid);
  }, []);

  /**
   * The drand value for the entered round, fetched from the PUBLIC relays — the
   * casino's copy is never trusted. If the casino recorded a value (`recorded`),
   * it is checked against the beacon's.
   */
  async function beaconValue(
    checks: Result['checks'],
    recorded?: string | null,
  ): Promise<string | null> {
    if (!beaconRound.trim()) return null;
    const round = Number(beaconRound);
    if (!Number.isInteger(round) || round < 1)
      throw new Error('Beacon round must be a positive integer');
    const fetched = await fetchBeaconRandomness(round, FAIR_BEACON.RELAYS, FAIR_BEACON.CHAIN_HASH);
    if (!fetched) throw new Error('Could not reach a drand relay — try again in a moment');
    checks.push({
      label: `drand round ${round} fetched from ${new URL(fetched.relay).host}`,
      ok: true,
    });
    if (recorded) {
      checks.push({
        label: 'The value the casino recorded equals the public beacon',
        ok: recorded.toLowerCase() === fetched.randomness,
      });
    }
    return fetched.randomness;
  }

  async function compute() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const checks: Result['checks'] = [];
      // A jackpot round id fills everything from the settled round itself.
      let jp: JackpotRoundDetail | null = null;
      if (game === 'jackpot' && jackpotRoundId.trim()) {
        jp = await api<JackpotRoundDetail>(`/jackpot/rounds/${jackpotRoundId.trim()}`);
      }
      const sSeed = serverSeed || jp?.serverSeed || '';
      const cSeed = clientSeed || jp?.clientSeed || '';
      if (!sSeed || !cSeed) {
        throw new Error('Both serverSeed and clientSeed are required');
      }
      const nonceNum = jp && nonce === '0' ? jp.nonce : parseInt(nonce, 10);
      if (!Number.isFinite(nonceNum) || nonceNum < 0) {
        throw new Error('Nonce must be a non-negative integer');
      }

      let output = '';
      if (game === 'crash') {
        const entropy = await beaconValue(checks, slotHash.trim() || null);
        const p = entropy
          ? await crashPointFromEntropy(sSeed, cSeed, entropy, nonceNum)
          : await crashPoint(sSeed, cSeed, nonceNum);
        output = `${p.toFixed(2)}×`;
      } else if (game === 'coinflip') {
        const r = await coinflipResult(sSeed, cSeed, nonceNum);
        output = r;
      } else if (game === 'lottery') {
        // A beacon draw is checked against the beacon itself; an older draw
        // needs the slot hash it published.
        const entropy = (await beaconValue(checks, slotHash.trim() || null)) ?? slotHash.trim();
        if (!entropy) {
          throw new Error(
            'Lottery needs the draw’s beacon round (or, for older draws, its slot hash) — both are on the draw’s results',
          );
        }
        const { digits } = await lotteryDraw(sSeed, cSeed, entropy, nonceNum);
        output = digits.join('  ');
      } else if (game === 'jackpot') {
        const entropy = await beaconValue(checks, jp?.entropy ?? null);
        if (jp) {
          // Everything needed to check the WINNER, not just the roll: the ticket
          // from the seeds (and beacon), then whose range holds it.
          const total = BigInt(jp.totalLamports);
          const ticket = entropy
            ? await jackpotTicketFromEntropy(sSeed, cSeed, entropy, nonceNum, total)
            : (await jackpotRoll(sSeed, cSeed, nonceNum)) % total;
          const idx = jackpotWinnerIndex(
            jp.ranges.map((r) => BigInt(r.amountLamports)),
            ticket,
          );
          const holder = jp.ranges[idx];
          checks.push({
            label: `Winning ticket ${ticket} matches the round's record`,
            ok: jp.winningTicket === ticket.toString(),
          });
          checks.push({
            label: `Ticket ${ticket} lies in ${holder?.player ?? '—'}'s range, and they were paid`,
            ok: !!holder && holder.playerId === jp.winnerPlayerId,
          });
          output =
            `ticket ${ticket} of ${total}\nwinner ${holder?.player ?? '—'}` +
            (holder ? `  [${holder.start}, ${holder.end})` : '');
        } else {
          const roll = await jackpotRoll(sSeed, cSeed, nonceNum);
          output = `roll ${roll}  (winner = roll mod pot — enter the round id to check the winner)`;
        }
      } else if (game === 'dice') {
        const roll = await diceRoll(sSeed, cSeed, nonceNum);
        const t = target.trim() ? Number(target) : null;
        const over = diceMode === 'over';
        const won = t !== null && (over ? roll >= t : roll < t);
        output =
          t !== null && Number.isFinite(t)
            ? `roll ${roll.toFixed(2)}  ·  target ${over ? '≥' : '<'}${t}  →  ${won ? `WIN ${diceMultiplier(t, diceMode).toFixed(2)}×` : 'LOSS'}`
            : `roll ${roll.toFixed(2)}  (${over ? 'roll-over: win when roll ≥ target' : 'roll-under: win when roll < target'})`;
      } else if (game === 'limbo') {
        const result = await limboResult(sSeed, cSeed, nonceNum, LIMBO.HOUSE_EDGE);
        const t = target.trim() ? Math.floor(Number(target) * 100) / 100 : null;
        output =
          t !== null && Number.isFinite(t)
            ? `result ${result.toFixed(2)}×  ·  target ${t.toFixed(2)}×  →  ${result >= t ? `WIN ${t.toFixed(2)}×` : 'LOSS'}`
            : `result ${result.toFixed(2)}×  (win when result ≥ target)`;
      } else if (game === 'wheel') {
        const index = await wheelSpin(sSeed, cSeed, nonceNum, WHEEL_SEGMENTS);
        const mult = wheelMultiplier(index);
        output = `segment ${index} / ${WHEEL_SEGMENTS}  →  ${mult}×`;
      } else if (game === 'plinko') {
        const r = parseInt(rows, 10);
        const payouts = plinkoPayouts(r);
        if (!payouts) {
          throw new Error(`Plinko rows must be one of ${PLINKO.ROWS.join(', ')}`);
        }
        const { path, bin } = await plinkoDrop(sSeed, cSeed, nonceNum, r);
        const mult = payouts[bin] ?? 0;
        const dirs = path.map((d) => (d ? 'R' : 'L')).join('');
        output = `bin ${bin} / ${r}  →  ${mult}×\npath ${dirs}`;
      } else if (game === 'mines') {
        const m = parseInt(mineCount, 10);
        if (!Number.isInteger(m) || m < MINES.MIN_MINES || m > MINES.MAX_MINES) {
          throw new Error(`Mine count must be in [${MINES.MIN_MINES}, ${MINES.MAX_MINES}]`);
        }
        const field = await mineField(sSeed, cSeed, nonceNum, MINES.CELLS, m);
        output = `mines at cells ${field.join(', ')}  (5×5 board, cells 0–24 left-to-right, top-to-bottom)`;
      } else if (game === 'hilo') {
        const seq = await hiloSequence(sSeed, cSeed, nonceNum, HILO.MAX_STEPS + 1);
        const cards = seq.map((c) => `${HILO_RANKS[c % 13]}${HILO_SUITS[Math.floor(c / 13)]}`);
        output = `committed sequence (base card first):\n${cards.join('  ')}`;
      } else if (game === 'keno') {
        const drawn = await kenoDraw(sSeed, cSeed, nonceNum, KENO.CELLS, KENO.DRAWS);
        output = `drawn numbers: ${drawn.join(', ')}  (${KENO.DRAWS} of 1–${KENO.CELLS}; your hits are the picks among them)`;
      } else if (game === 'tower') {
        const traps = await towerTraps(
          sSeed,
          cSeed,
          nonceNum,
          TOWER.ROWS,
          TOWER.COLUMNS,
          TOWER.SAFE_PER_ROW,
        );
        output = traps
          .map((cols, r2) => `row ${r2 + 1}: trap at column ${cols.map((c) => c + 1).join(', ')}`)
          .join('\n');
      } else {
        output = await verifyBlackjack(sSeed, cSeed, nonceNum, dealLog);
      }

      const commit = commitHash.trim() || jp?.serverSeedHash || '';
      const commitOk = commit ? await verifyCommit(sSeed, commit) : null;

      setResult({ game, output, commitOk, checks });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">Game</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {GAMES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGame(g);
                setResult(null);
              }}
              className={cn(
                'py-2 rounded-lg border text-sm font-semibold capitalize transition-colors',
                game === g
                  ? 'border-primary-400 bg-primary-400/10 text-primary-400'
                  : 'border-border bg-surface-elevated text-foreground-muted hover:border-primary-400/30',
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <TextField
        label="Server seed (revealed after round)"
        value={serverSeed}
        onChange={setServerSeed}
        placeholder="64-char hex"
        mono
      />
      <TextField
        label="Client seed"
        value={clientSeed}
        onChange={setClientSeed}
        placeholder="client-chosen entropy"
        mono
      />
      <TextField label="Nonce" value={nonce} onChange={setNonce} placeholder="0" mono />
      {game === 'jackpot' && (
        <TextField
          label="Round id (optional — checks the winning ticket AND who owned it)"
          value={jackpotRoundId}
          onChange={setJackpotRoundId}
          placeholder="from the round's Verify link"
          mono
        />
      )}
      {BEACON_GAMES.includes(game) && (
        <TextField
          label="drand beacon round (from the round's details)"
          value={beaconRound}
          onChange={setBeaconRound}
          placeholder="e.g. 32459457"
          mono
        />
      )}
      {(game === 'lottery' || game === 'crash') && (
        <TextField
          label={
            game === 'lottery'
              ? 'Draw entropy / slot hash (older draws; a beacon draw is fetched from drand)'
              : 'Recorded entropy (optional — checked against the beacon)'
          }
          value={slotHash}
          onChange={setSlotHash}
          placeholder="64-char hex"
          mono
        />
      )}
      {BEACON_GAMES.includes(game) && (
        <p className="-mt-2 text-[11px] text-foreground-muted">
          The result folds in the{' '}
          <strong>first drand beacon value published after betting closed</strong> — fetched here
          straight from the public relays (
          <a
            className="underline"
            href={beaconRoundUrl(Number(beaconRound) || 1)}
            target="_blank"
            rel="noreferrer"
          >
            {FAIR_BEACON.NAME}
          </a>
          ), so nobody, the casino included, could know it while bets were open. Older draws marked{' '}
          <span className="text-danger">synthetic-not-fair</span> predate the beacon and are{' '}
          <strong>not</strong> provably fair.
        </p>
      )}
      {game === 'blackjack' && (
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
            Deal log (the round&apos;s deal order, or your seat&apos;s deck indices)
          </div>
          <textarea
            value={dealLog}
            onChange={(e) => setDealLog(e.target.value)}
            placeholder={
              'Round deal log: [{"deckIndex":0,"dealtTo":0,"handId":"seat-0-0"}, …]\n' +
              'or just your seat deck indices: [0,3,6]'
            }
            rows={5}
            className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-primary-400"
          />
          <p className="mt-1 text-[11px] text-foreground-muted">
            A busy table deals more than 10 cards off one shared deck — paste the deal order so the
            verifier maps each deck index to the exact card you received.
          </p>
        </div>
      )}
      {game === 'mines' && (
        <TextField
          label={`Mine count (your round's setting, [${MINES.MIN_MINES}, ${MINES.MAX_MINES}])`}
          value={mineCount}
          onChange={setMineCount}
          placeholder="e.g. 3"
          mono
        />
      )}
      {game === 'dice' && (
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
            Win rule (your bet&apos;s mode)
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DICE.MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setDiceMode(m);
                  setResult(null);
                }}
                className={cn(
                  'py-2 rounded-lg border text-sm font-semibold capitalize transition-colors',
                  diceMode === m
                    ? 'border-primary-400 bg-primary-400/10 text-primary-400'
                    : 'border-border bg-surface-elevated text-foreground-muted hover:border-primary-400/30',
                )}
              >
                Roll {m}
              </button>
            ))}
          </div>
        </div>
      )}
      {(game === 'dice' || game === 'limbo') && (
        <TextField
          label={
            game === 'dice'
              ? `Roll-${diceMode} target (optional — your bet's target, [${DICE.MIN_TARGET}, ${DICE.MAX_TARGET}])`
              : `Target multiplier (optional — your bet's target, [${LIMBO.MIN_TARGET}, ${LIMBO.MAX_TARGET}])`
          }
          value={target}
          onChange={setTarget}
          placeholder={game === 'dice' ? 'e.g. 50' : 'e.g. 2.00'}
          mono
        />
      )}
      {game === 'limbo' && (
        <p className="-mt-2 text-[11px] text-foreground-muted">
          The result is computed from the seeds alone (platform edge{' '}
          {(LIMBO.HOUSE_EDGE * 100).toFixed(0)}% baked in). Enter your target to see whether the
          round would have won.
        </p>
      )}
      {game === 'plinko' && (
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
            Rows (the board size of your bet)
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PLINKO.ROWS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRows(String(r))}
                className={cn(
                  'py-2 rounded-lg border text-sm font-semibold transition-colors',
                  rows === String(r)
                    ? 'border-primary-400 bg-primary-400/10 text-primary-400'
                    : 'border-border bg-surface-elevated text-foreground-muted hover:border-primary-400/30',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
      {game === 'wheel' && (
        <p className="text-[11px] text-foreground-muted">
          The spin lands on one of {WHEEL_SEGMENTS} weighted segments; the verifier maps the index
          to its payout multiplier (from the shared bucket table, EV ≈ 0.965).
        </p>
      )}
      <TextField
        label="Server seed hash (optional — verifies the commitment)"
        value={commitHash}
        onChange={setCommitHash}
        placeholder="sha256 of serverSeed, published before the round"
        mono
      />

      <Button onClick={compute} size="lg" className="w-full" disabled={loading}>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ShieldCheck className="h-5 w-5" />
        )}
        Verify
      </Button>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-surface-elevated p-5 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
              {result.game} result
            </div>
            <div className="text-2xl font-bold font-mono break-all whitespace-pre-line text-gradient">
              {result.output}
            </div>
          </div>
          {result.checks.map((c) => (
            <div
              key={c.label}
              className={cn(
                'flex items-center gap-2 text-sm border-t border-border pt-3',
                c.ok ? 'text-success' : 'text-danger',
              )}
            >
              {c.ok ? <Check className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
              {c.label}
            </div>
          ))}
          {result.commitOk !== null && (
            <div
              className={cn(
                'flex items-center gap-2 text-sm border-t border-border pt-3',
                result.commitOk ? 'text-success' : 'text-danger',
              )}
            >
              {result.commitOk ? (
                <>
                  <Check className="h-4 w-4" />
                  Commit matches — the server didn&apos;t swap seeds
                </>
              ) : (
                <>
                  <X className="h-4 w-4" />
                  Commit mismatch — seed was tampered with
                </>
              )}
            </div>
          )}
          <p className="text-[11px] text-foreground-muted border-t border-border pt-3">
            Computed locally in your browser via WebCrypto HMAC-SHA256. Nothing was sent to the
            server.
          </p>
        </div>
      )}
    </div>
  );
}

/** Best blackjack total (Aces 11→1 as needed) — local so the verifier stays
 * WebCrypto-only and never imports the node-backed @scadium/fair. */
function handTotal(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      total += 11;
      aces++;
    } else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') {
      total += 10;
    } else {
      total += parseInt(c.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

const fmtCard = (c: Card) => `${c.rank}${c.suit}`;

/**
 * Reproduce a blackjack round (or a single seat's hand) from the revealed seed
 * + the deal order. Accepts either the full deal-order log
 * (`[{deckIndex, dealtTo, handId}, …]`) → every seat/hand + dealer, or a flat
 * list of deck indices (`[0,3,6]`) → just that one hand. No hardcoded card count.
 */
async function verifyBlackjack(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  dealLogInput: string,
): Promise<string> {
  const trimmed = dealLogInput.trim();
  if (!trimmed) {
    throw new Error(
      'Paste the round deal log ([{deckIndex,dealtTo,handId}, …]) or your seat deck indices ([0,3,6]) — from the round’s fairness data',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Deal log must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Deal log must be a non-empty JSON array');
  }

  // Flat array of deck indices → reproduce a single hand.
  if (typeof parsed[0] === 'number') {
    const indices = parsed as number[];
    if (!indices.every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error('Deck indices must be non-negative integers');
    }
    const cards = await reproduceHand(serverSeed, clientSeed, nonce, indices);
    return `your hand: ${cards.map(fmtCard).join(' ')}  (${handTotal(cards)})`;
  }

  // Full deal-order log → reproduce every seat/hand + the dealer.
  const order = parsed as DealLogEntry[];
  if (!order.every((e) => e && typeof e.deckIndex === 'number' && e.handId !== undefined)) {
    throw new Error('Each deal-log entry needs a numeric deckIndex and a handId');
  }
  const hands = await reproduceRound(serverSeed, clientSeed, nonce, order);
  return hands
    .map((h) => {
      const who = h.dealtTo === 'dealer' ? 'dealer' : `seat ${h.dealtTo} (${h.handId})`;
      return `${who}: ${h.cards.map(fmtCard).join(' ')}  (${handTotal(h.cards)})`;
    })
    .join('\n');
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm focus:outline-none focus:border-primary-400',
          mono && 'font-mono',
        )}
      />
    </div>
  );
}
