"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateServerSeed = generateServerSeed;
exports.generateClientSeed = generateClientSeed;
exports.commitServerSeed = commitServerSeed;
const node_crypto_1 = require("node:crypto");
const hash_1 = require("./hash");
/**
 * Generate a cryptographically-secure random server seed (64 hex chars = 256 bits).
 */
function generateServerSeed() {
    return (0, node_crypto_1.randomBytes)(32).toString('hex');
}
/**
 * Generate a random default client seed. Players can override this.
 */
function generateClientSeed() {
    return (0, node_crypto_1.randomBytes)(16).toString('hex');
}
/**
 * Commit to a server seed by publishing its SHA-256 hash before the round.
 * Revealing the preimage after settlement proves it was not tampered with.
 */
function commitServerSeed(serverSeed) {
    return (0, hash_1.sha256)(serverSeed);
}
//# sourceMappingURL=seed.js.map