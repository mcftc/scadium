"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blackjackDeal = blackjackDeal;
exports.cardValue = cardValue;
exports.handValue = handValue;
exports.isBlackjack = isBlackjack;
exports.isBust = isBust;
const hash_1 = require("./hash");
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['H', 'D', 'C', 'S'];
/**
 * Deterministic card dealer for blackjack, derived from HMAC-SHA256 stream.
 * Uses the "infinite deck" model — each card is drawn independently with
 * equal probability from 52, which is mathematically equivalent to an
 * infinite reshuffled shoe.
 *
 * The card index at position `i` is:
 *   card_i = hmac(serverSeed, `${clientSeed}:${nonce}:${i}`)[0..2] % 52
 *
 * @returns `count` deterministic cards in order
 */
function blackjackDeal(serverSeed, clientSeed, nonce, count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
        const msg = `${(0, hash_1.buildMessage)(clientSeed, nonce)}:${i}`;
        const hash = (0, hash_1.hmacSha256)(serverSeed, msg);
        // Use 4 hex chars (16 bits) to reduce modulo bias on 52
        const n = parseInt(hash.slice(0, 4), 16) % 52;
        const rank = RANKS[n % 13];
        const suit = SUITS[Math.floor(n / 13)];
        cards.push({ rank, suit });
    }
    return cards;
}
/**
 * Value of a single card for blackjack hand-total calculation.
 * Aces count as 11 initially; downgrade logic lives in handValue.
 */
function cardValue(card) {
    if (card.rank === 'A')
        return 11;
    if (['K', 'Q', 'J', '10'].includes(card.rank))
        return 10;
    return parseInt(card.rank, 10);
}
/**
 * Compute the best (non-busting if possible) hand total for a set of cards.
 * Returns an object with the total and whether the hand is "soft" (contains
 * an Ace still counted as 11).
 */
function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
        total += cardValue(c);
        if (c.rank === 'A')
            aces++;
    }
    // Downgrade Aces from 11 to 1 while busting
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return { total, soft: aces > 0 };
}
function isBlackjack(cards) {
    return cards.length === 2 && handValue(cards).total === 21;
}
function isBust(cards) {
    return handValue(cards).total > 21;
}
//# sourceMappingURL=blackjack.js.map