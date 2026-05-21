"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.hmacSha256 = hmacSha256;
exports.buildMessage = buildMessage;
const node_crypto_1 = require("node:crypto");
/**
 * SHA-256 hex digest of a UTF-8 string.
 */
function sha256(input) {
    return (0, node_crypto_1.createHash)('sha256').update(input, 'utf8').digest('hex');
}
/**
 * HMAC-SHA256 with the server seed as key and a client-controlled message.
 * This is the canonical primitive for provably-fair game results — the server
 * commits to sha256(serverSeed) before the round, reveals serverSeed after,
 * and the player can reproduce the exact result client-side.
 *
 * @param serverSeed - secret seed controlled by the server (revealed after round)
 * @param message - typically `${clientSeed}:${nonce}`
 * @returns lowercase hex digest
 */
function hmacSha256(serverSeed, message) {
    return (0, node_crypto_1.createHmac)('sha256', serverSeed).update(message, 'utf8').digest('hex');
}
/**
 * Build the canonical HMAC message used across all Scadium games.
 */
function buildMessage(clientSeed, nonce) {
    return `${clientSeed}:${nonce}`;
}
//# sourceMappingURL=hash.js.map