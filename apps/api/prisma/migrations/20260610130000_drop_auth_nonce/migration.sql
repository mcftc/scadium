-- #12: SIWS nonces now live in Redis (siws:nonce:<wallet> with a TTL). The
-- AuthNonce table was created in the init migration but never read or written.
DROP TABLE IF EXISTS "AuthNonce";
