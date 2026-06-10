import nacl from 'tweetnacl';
import bs58 from 'bs58';
import request from 'supertest';
import type { Server } from 'node:http';

export interface SignInResult {
  walletAddress: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Drive a real SIWS sign-in over HTTP (nonce → sign → verify) with a fresh
 * Solana keypair, returning the issued access + refresh tokens. Needs Redis up
 * (the nonce store). Shared by the #35 session/refresh specs. Not a
 * `*.e2e-spec.ts` file, so the runner does not execute it directly.
 */
export async function siwsSignIn(server: Server): Promise<SignInResult> {
  const kp = nacl.sign.keyPair();
  const walletAddress = bs58.encode(kp.publicKey);

  const nonceRes = await request(server).post('/api/v1/auth/nonce').send({ walletAddress });
  if (nonceRes.status !== 201) throw new Error(`nonce failed: ${nonceRes.status}`);
  const { nonce, message } = nonceRes.body as { nonce: string; message: string };

  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

  const verifyRes = await request(server)
    .post('/api/v1/auth/verify')
    .send({ walletAddress, nonce, signature, message });
  if (verifyRes.status !== 201) throw new Error(`verify failed: ${verifyRes.status}`);

  const { accessToken, refreshToken } = verifyRes.body as {
    accessToken: string;
    refreshToken: string;
  };
  return { walletAddress, accessToken, refreshToken };
}
