"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fairVerifySchema = exports.updateProfileSchema = exports.chatMessageSchema = exports.blackjackActionSchema = exports.blackjackJoinSchema = exports.crashCashoutSchema = exports.crashBetSchema = exports.joinCoinflipSchema = exports.createCoinflipSchema = exports.siwsVerifySchema = exports.nonceRequestSchema = void 0;
const zod_1 = require("zod");
const constants_1 = require("./constants");
// ---------- Auth ----------
exports.nonceRequestSchema = zod_1.z.object({
    walletAddress: zod_1.z.string().min(32).max(44),
});
exports.siwsVerifySchema = zod_1.z.object({
    walletAddress: zod_1.z.string().min(32).max(44),
    nonce: zod_1.z.string().min(8),
    signature: zod_1.z.string().min(64),
    message: zod_1.z.string().min(1),
});
// ---------- Coinflip ----------
exports.createCoinflipSchema = zod_1.z.object({
    side: zod_1.z.enum(constants_1.COINFLIP.SIDES),
    amountLamports: zod_1.z
        .string()
        .regex(/^\d+$/, 'amountLamports must be a positive integer string')
        .refine((v) => {
        const n = BigInt(v);
        return n >= BigInt(constants_1.COINFLIP.MIN_BET_LAMPORTS) && n <= BigInt(constants_1.COINFLIP.MAX_BET_LAMPORTS);
    }, 'bet out of range'),
});
exports.joinCoinflipSchema = zod_1.z.object({
    gameId: zod_1.z.string().uuid(),
});
// ---------- Crash ----------
exports.crashBetSchema = zod_1.z.object({
    amountLamports: zod_1.z
        .string()
        .regex(/^\d+$/)
        .refine((v) => {
        const n = BigInt(v);
        return n >= BigInt(constants_1.CRASH.MIN_BET_LAMPORTS) && n <= BigInt(constants_1.CRASH.MAX_BET_LAMPORTS);
    }),
    autoCashoutMultiplier: zod_1.z
        .number()
        .min(constants_1.CRASH.MIN_CASHOUT_MULTIPLIER)
        .max(constants_1.CRASH.MAX_CASHOUT_MULTIPLIER)
        .optional(),
});
exports.crashCashoutSchema = zod_1.z.object({
    roundId: zod_1.z.string().uuid(),
});
// ---------- Blackjack ----------
exports.blackjackJoinSchema = zod_1.z.object({
    tableId: zod_1.z.string().uuid(),
    seatIndex: zod_1.z.number().int().min(0).max(constants_1.BLACKJACK.MAX_SEATS - 1),
    amountLamports: zod_1.z
        .string()
        .regex(/^\d+$/)
        .refine((v) => {
        const n = BigInt(v);
        return n >= BigInt(constants_1.BLACKJACK.MIN_BET_LAMPORTS) && n <= BigInt(constants_1.BLACKJACK.MAX_BET_LAMPORTS);
    }),
});
exports.blackjackActionSchema = zod_1.z.object({
    tableId: zod_1.z.string().uuid(),
    action: zod_1.z.enum(['hit', 'stand', 'double', 'split', 'insurance']),
});
// ---------- Chat ----------
exports.chatMessageSchema = zod_1.z.object({
    body: zod_1.z.string().min(1).max(constants_1.CHAT.MESSAGE_MAX_LEN),
});
// ---------- Profile ----------
exports.updateProfileSchema = zod_1.z.object({
    username: zod_1.z
        .string()
        .min(3)
        .max(20)
        .regex(/^[a-zA-Z0-9_]+$/, 'alphanumeric + underscore only')
        .optional(),
    avatarUrl: zod_1.z.string().url().optional(),
});
// ---------- Fairness verifier ----------
exports.fairVerifySchema = zod_1.z.object({
    game: zod_1.z.enum(['crash', 'coinflip', 'blackjack']),
    serverSeed: zod_1.z.string().min(32),
    clientSeed: zod_1.z.string().min(1),
    nonce: zod_1.z.number().int().min(0),
});
//# sourceMappingURL=schemas.js.map