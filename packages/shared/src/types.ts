import type { GameType, CoinflipSide } from './constants';

// ---------- User ----------
export interface User {
  id: string;
  walletAddress: string;
  username: string | null;
  avatarUrl: string | null;
  createdAt: string;
  refCode: string;
  referredBy: string | null;
  banned: boolean;
  role: 'user' | 'admin' | 'moderator';
}

export interface UserStats {
  totalWageredLamports: string; // bigint serialized
  totalWonLamports: string;
  totalLostLamports: string;
  gamesPlayed: number;
  biggestWinLamports: string;
}

// ---------- Bets ----------
export interface BetRecord {
  id: string;
  userId: string;
  gameType: GameType;
  amountLamports: string;
  payoutLamports: string;
  multiplier: number | null;
  won: boolean;
  txSignature: string | null;
  seedId: string | null;
  nonce: number | null;
  createdAt: string;
  resultJson: unknown;
}

// ---------- Crash ----------
export type CrashRoundStatus = 'waiting' | 'running' | 'busted';

export interface CrashRound {
  id: string;
  status: CrashRoundStatus;
  startedAt: string | null;
  endedAt: string | null;
  bustMultiplier: number | null;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  nonce: number;
}

export interface CrashBet {
  id: string;
  roundId: string;
  userId: string;
  username: string | null;
  amountLamports: string;
  autoCashoutMultiplier: number | null;
  cashoutMultiplier: number | null;
  payoutLamports: string | null;
  status: 'placed' | 'cashed_out' | 'lost';
}

// ---------- Coinflip ----------
export type CoinflipStatus = 'open' | 'matched' | 'resolving' | 'completed' | 'cancelled';

export interface CoinflipGame {
  id: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorSide: CoinflipSide;
  joinerId: string | null;
  joinerUsername: string | null;
  amountLamports: string;
  result: CoinflipSide | null;
  winnerId: string | null;
  status: CoinflipStatus;
  createdAt: string;
  resolvedAt: string | null;
  txSignature: string | null;
}

// ---------- Blackjack ----------
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Suit = 'H' | 'D' | 'C' | 'S';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type BlackjackAction = 'hit' | 'stand' | 'double' | 'split' | 'insurance';

export interface BlackjackHand {
  cards: Card[];
  betLamports: string;
  status: 'playing' | 'standing' | 'busted' | 'blackjack' | 'surrendered';
  isSplit?: boolean;
}

export interface BlackjackSeat {
  seatIndex: number;
  userId: string | null;
  username: string | null;
  hands: BlackjackHand[];
  activeHandIndex: number;
}

export type BlackjackTableStatus =
  | 'waiting'
  | 'betting'
  | 'dealing'
  | 'player_turns'
  | 'dealer_turn'
  | 'settling';

export interface BlackjackTable {
  id: string;
  status: BlackjackTableStatus;
  seats: BlackjackSeat[];
  dealerHand: Card[];
  minBetLamports: string;
  maxBetLamports: string;
  activeSeatIndex: number | null;
  serverSeedHash: string;
  nonce: number;
}

// ---------- Chat ----------
export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  role: 'user' | 'admin' | 'moderator';
}

// ---------- Airdrop / Leaderboard ----------
export interface AirdropEvent {
  id: string;
  distributedAt: string;
  totalLamports: string;
  participantCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string | null;
  walletAddress: string;
  volumeLamports: string;
  wins: number;
}

// ---------- Provably fair result ----------
export interface FairResult {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  hash: string;
  result: number | string;
}
