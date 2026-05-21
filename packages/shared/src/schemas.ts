import { z } from 'zod';
import { COINFLIP, CRASH, BLACKJACK, CHAT } from './constants';

// ---------- Auth ----------
export const nonceRequestSchema = z.object({
  walletAddress: z.string().min(32).max(44),
});

export const siwsVerifySchema = z.object({
  walletAddress: z.string().min(32).max(44),
  nonce: z.string().min(8),
  signature: z.string().min(64),
  message: z.string().min(1),
});

// ---------- Coinflip ----------
export const createCoinflipSchema = z.object({
  side: z.enum(COINFLIP.SIDES),
  amountLamports: z
    .string()
    .regex(/^\d+$/, 'amountLamports must be a positive integer string')
    .refine((v) => {
      const n = BigInt(v);
      return n >= BigInt(COINFLIP.MIN_BET_LAMPORTS) && n <= BigInt(COINFLIP.MAX_BET_LAMPORTS);
    }, 'bet out of range'),
});

export const joinCoinflipSchema = z.object({
  gameId: z.string().uuid(),
});

// ---------- Crash ----------
export const crashBetSchema = z.object({
  amountLamports: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => {
      const n = BigInt(v);
      return n >= BigInt(CRASH.MIN_BET_LAMPORTS) && n <= BigInt(CRASH.MAX_BET_LAMPORTS);
    }),
  autoCashoutMultiplier: z
    .number()
    .min(CRASH.MIN_CASHOUT_MULTIPLIER)
    .max(CRASH.MAX_CASHOUT_MULTIPLIER)
    .optional(),
});

export const crashCashoutSchema = z.object({
  roundId: z.string().uuid(),
});

// ---------- Blackjack ----------
export const blackjackJoinSchema = z.object({
  tableId: z.string().uuid(),
  seatIndex: z.number().int().min(0).max(BLACKJACK.MAX_SEATS - 1),
  amountLamports: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => {
      const n = BigInt(v);
      return n >= BigInt(BLACKJACK.MIN_BET_LAMPORTS) && n <= BigInt(BLACKJACK.MAX_BET_LAMPORTS);
    }),
});

export const blackjackActionSchema = z.object({
  tableId: z.string().uuid(),
  action: z.enum(['hit', 'stand', 'double', 'split', 'insurance']),
});

// ---------- Chat ----------
export const chatMessageSchema = z.object({
  body: z.string().min(1).max(CHAT.MESSAGE_MAX_LEN),
});

// ---------- Profile ----------
export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'alphanumeric + underscore only')
    .optional(),
  avatarUrl: z.string().url().optional(),
});

// ---------- Fairness verifier ----------
export const fairVerifySchema = z.object({
  game: z.enum(['crash', 'coinflip', 'blackjack']),
  serverSeed: z.string().min(32),
  clientSeed: z.string().min(1),
  nonce: z.number().int().min(0),
});
