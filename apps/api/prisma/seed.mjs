/**
 * Demo seed — populates the leaderboard and chat so the app doesn't look empty
 * in a live demo. Idempotent: re-running won't create duplicates (keyed on
 * the deterministic demo wallet addresses). Safe to run against a dev DB only.
 *
 *   node prisma/seed.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SOL = 1_000_000_000n;

// Deterministic base58-ish demo wallets (so re-seeding is idempotent).
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function demoWallet(i) {
  // 44-char pseudo-address seeded by index — stable across runs.
  let s = '';
  let x = (i + 1) * 2654435761;
  for (let k = 0; k < 44; k++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += B58[x % B58.length];
  }
  return s;
}

const DEMO = [
  { name: 'satoshi_whale', wagered: 1240n, won: 187n, games: 412 },
  { name: 'degenking', wagered: 890n, won: -64n, games: 530 },
  { name: 'moonshot', wagered: 612n, won: 96n, games: 288 },
  { name: 'solflare_sam', wagered: 455n, won: 41n, games: 199 },
  { name: 'cryptomommy', wagered: 388n, won: -22n, games: 240 },
  { name: 'lucky_luc', wagered: 310n, won: 73n, games: 150 },
  { name: 'phantom_phil', wagered: 244n, won: 12n, games: 130 },
  { name: 'bonkbonk', wagered: 173n, won: -31n, games: 188 },
  { name: 'ape_together', wagered: 96n, won: 19n, games: 71 },
  { name: 'diamond_hands', wagered: 58n, won: 7n, games: 44 },
];

const CHAT = [
  'gm degens 🌞',
  'just hit 12x on crash lmao',
  'lottery jackpot when',
  'verify your seeds people, this place is legit',
  'down bad on coinflip today',
  'wagmi 🚀',
  'that 3.76x bust hurt',
  'bought 5 lottery tickets, feeling lucky',
  'provably fair ftw',
  'who else aping the next draw',
];

async function main() {
  const userIds = [];
  for (let i = 0; i < DEMO.length; i++) {
    const d = DEMO[i];
    const walletAddress = demoWallet(i);
    const refCode = `DEMO${String(i).padStart(2, '0')}${B58[i] ?? 'X'}`;
    const user = await prisma.user.upsert({
      where: { walletAddress },
      update: {
        totalWagered: d.wagered * SOL,
        totalWon: d.won >= 0n ? d.won * SOL : 0n,
        totalLost: d.won < 0n ? -d.won * SOL : 0n,
        gamesPlayed: d.games,
        biggestWin: (d.won > 0n ? d.won : 5n) * SOL,
      },
      create: {
        walletAddress,
        username: d.name,
        refCode,
        totalWagered: d.wagered * SOL,
        totalWon: d.won >= 0n ? d.won * SOL : 0n,
        totalLost: d.won < 0n ? -d.won * SOL : 0n,
        gamesPlayed: d.games,
        biggestWin: (d.won > 0n ? d.won : 5n) * SOL,
      },
    });
    userIds.push(user.id);
  }

  // Seed chat only if (nearly) empty, so we don't keep stacking messages.
  const existingChat = await prisma.chatMessage.count();
  if (existingChat < CHAT.length) {
    await prisma.chatMessage.deleteMany({}); // clear any partial seed
    for (let i = 0; i < CHAT.length; i++) {
      await prisma.chatMessage.create({
        data: { userId: userIds[i % userIds.length], body: CHAT[i] },
      });
    }
  }

  console.log(`Seeded ${DEMO.length} demo users + ${CHAT.length} chat messages.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
