"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coinflipResult = coinflipResult;
const hash_1 = require("./hash");
/**
 * Deterministic 50/50 coinflip result derived from HMAC-SHA256.
 * Takes the first byte (2 hex chars) of the hash; even → heads, odd → tails.
 */
function coinflipResult(serverSeed, clientSeed, nonce) {
    const hash = (0, hash_1.hmacSha256)(serverSeed, (0, hash_1.buildMessage)(clientSeed, nonce));
    const firstByte = parseInt(hash.slice(0, 2), 16);
    return firstByte % 2 === 0 ? 'heads' : 'tails';
}
//# sourceMappingURL=coinflip.js.map