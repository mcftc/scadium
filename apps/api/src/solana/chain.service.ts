import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { HOUSE } from '@scadium/shared';
import { settlementMoved } from './settlement-verify';
import { parseVaultEvent, type VaultEvent } from './vault-events';
import { COSIGNER_PROVIDER, type CosignerKeyProvider } from './cosigner-key.provider';
import { coversReserve, reserveFloorLamports } from './treasury-guard';
import { treasuryPayoutBlockedTotal, payoutFailedTotal } from '../observability/metrics.registry';

/** Rent::minimum_balance(0) for the house_vault PDA (mirrors reconciliation). */
const HOUSE_VAULT_RENT_FLOOR = 890_880n;

/**
 * Thin Solana layer for the scadium_vault program (Phase A).
 *
 * Deliberately IDL-free: the program's instruction data is Anchor-encoded
 * (8-byte discriminator = sha256("global:<name>")[0..8] + borsh args), which
 * we assemble by hand here. This keeps the API decoupled from the anchor
 * build pipeline — the IDL is only needed by tests and (optionally) the web.
 *
 * The cosigner hot key signs ONLY settle_bet/claim_reward — the program
 * constrains what it can do (see programs/scadium_vault/src/lib.rs).
 */
@Injectable()
export class ChainService implements OnModuleInit {
  private readonly logger = new Logger(ChainService.name);
  /** Exposed for reconciliation (#26) and integration tests. */
  connection!: Connection;
  private programId: PublicKey | null = null;
  enabled = false;

  /**
   * Cosigner signing key, sourced through the custody provider (#36) — the
   * service never reads a plaintext key from disk itself. For the dev file
   * provider this is the loaded Keypair; for a managed (KMS) provider it is
   * null (signing happens via the provider). All privileged tx paths guard on
   * `enabled` (which requires `cosignerProvider.available`) before using it.
   */
  private get cosigner(): Keypair | null {
    return this.cosignerProvider.signer;
  }

  /** Cosigner public key for PDA / account-meta derivation, from the provider. */
  get cosignerPublicKey(): PublicKey | null {
    return this.cosignerProvider.publicKey;
  }

  get programIdBase58(): string | null {
    return this.programId?.toBase58() ?? null;
  }

  /** Configured Solana cluster (#53). Drives the web's explorer links + tx
   *  building; defaults to devnet so the play-money/beta deploy is unchanged. */
  get cluster(): string {
    return this.config.get<string>('SOLANA_NETWORK')?.trim() || 'devnet';
  }

  private scadMint: PublicKey | null = null;
  // SCAD Engine: USD-pegged dividend mint stakers are paid in (claim_dividend).
  private usdsMint: PublicKey | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(COSIGNER_PROVIDER) private readonly cosignerProvider: CosignerKeyProvider,
  ) {}

  onModuleInit() {
    const rpcUrl = this.config.get<string>('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    const programId = this.config.get<string>('VAULT_PROGRAM_ID');
    // The cosigner key comes through the custody provider (#36): production
    // fails closed (no plaintext key from disk), and a managed/KMS provider is
    // required there. `available` is false in play-money mode.
    if (!programId || !this.cosignerProvider.available) {
      this.logger.warn(
        `On-chain settlement disabled (play-money mode) — programId=${!!programId}, cosigner=${this.cosignerProvider.kind}/${this.cosignerProvider.available}`,
      );
      return;
    }
    try {
      this.programId = new PublicKey(programId);
      const scadMint = this.config.get<string>('SCAD_MINT');
      this.scadMint = scadMint ? new PublicKey(scadMint) : null;
      const usdsMint = this.config.get<string>('USDS_MINT');
      this.usdsMint = usdsMint ? new PublicKey(usdsMint) : null;
      const lotteryProgramId = this.config.get<string>('LOTTERY_PROGRAM_ID');
      this.lotteryProgramId = lotteryProgramId ? new PublicKey(lotteryProgramId) : null;
      this.enabled = true;
      this.logger.log(
        `On-chain settlement enabled — program ${programId}, cosigner ${this.cosignerProvider.publicKey?.toBase58()} (${this.cosignerProvider.kind})`,
      );
    } catch (e) {
      this.logger.error(`Failed to init chain service: ${(e as Error).message}`);
    }
  }

  /**
   * Rotate the cosigner key without a redeploy (#36): re-load it through the
   * provider and re-derive `enabled`. Returns the active cosigner public key.
   */
  reloadCosigner(): string | null {
    this.cosignerProvider.reload();
    this.enabled = !!this.programId && this.cosignerProvider.available;
    const pk = this.cosignerProvider.publicKey?.toBase58() ?? null;
    this.logger.warn(`Cosigner reloaded (rotation) — enabled=${this.enabled}, cosigner=${pk}`);
    return pk;
  }

  // ---------------------------------------------------------------- PDAs

  housePda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('house')], this.programId!)[0];
  }

  houseVaultPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('house_vault')], this.programId!)[0];
  }

  userVaultPdaBase58(walletAddress: string): string {
    return this.userVaultPda(new PublicKey(walletAddress)).toBase58();
  }

  userVaultPda(user: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user_vault'), user.toBuffer()],
      this.programId!,
    )[0];
  }

  // ------------------------------------------------------------- queries

  /** Live house bankroll (house_vault PDA lamports) — the exposure base (#30).
   * `null` = unreadable (disabled / RPC down): callers fail OPEN on the
   * API-side guard (the on-chain rent floor in `settle_bet` stays the hard
   * stop), while a real `0n` (vault missing/empty) fails CLOSED. */
  async houseVaultBalance(): Promise<bigint | null> {
    if (!this.enabled) return null;
    try {
      const info = await this.connection.getAccountInfo(this.houseVaultPda());
      return info ? BigInt(info.lamports) : 0n;
    } catch {
      return null;
    }
  }

  /** Documented reserve floor (#54): rent floor + operational bankroll buffer. */
  get reserveFloorLamports(): bigint {
    return reserveFloorLamports(HOUSE_VAULT_RENT_FLOOR, BigInt(HOUSE.MIN_BANKROLL_BUFFER_LAMPORTS));
  }

  /**
   * Solvency guard (#54): refuse a house SOL payout BEFORE building the tx when
   * it would drop the house vault below the reserve floor — caught here instead
   * of the program's on-chain `InsufficientFunds`. Fails OPEN when the balance
   * is unreadable (the on-chain rent floor stays the hard stop). Returns true if
   * the payout may proceed; bumps `treasury_payout_blocked_total` and returns
   * false when it must be refused.
   */
  private async reserveCoversPayout(housePaysNet: bigint, kind: string): Promise<boolean> {
    if (housePaysNet <= 0n) return true;
    const balance = await this.houseVaultBalance();
    if (balance === null) return true; // unreadable → fail open (rent floor is the hard stop)
    if (coversReserve(balance, housePaysNet, this.reserveFloorLamports)) return true;
    treasuryPayoutBlockedTotal.inc({ kind });
    this.logger.error(
      `${kind}: refusing payout of net ${housePaysNet} — house vault ${balance} would breach reserve floor ${this.reserveFloorLamports}. Top up the bankroll.`,
    );
    return false;
  }

  /** Lamports sitting in a user's vault PDA (0 if the PDA doesn't exist). */
  async vaultBalance(walletAddress: string): Promise<bigint> {
    if (!this.enabled) return 0n;
    const pda = this.userVaultPda(new PublicKey(walletAddress));
    const info = await this.connection.getAccountInfo(pda);
    return info ? BigInt(info.lamports) : 0n;
  }

  /**
   * Verify a user-signed vault deposit/withdraw (#27): fetch the confirmed
   * transaction and decode the PROGRAM's own Deposited/Withdrawn event from its
   * logs — never trusting client-reported amounts. Returns the event (owner +
   * exact lamports) or null when the tx failed, is missing, or carries no such
   * event for this wallet.
   */
  async verifyVaultTransfer(
    signature: string,
    walletAddress: string,
    kind: 'deposit' | 'withdraw',
  ): Promise<VaultEvent | null> {
    if (!this.enabled) return null;
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta || tx.meta.err !== null) return null;
      const event = parseVaultEvent(
        tx.meta.logMessages,
        kind === 'deposit' ? 'Deposited' : 'Withdrawn',
      );
      if (!event || event.user !== walletAddress || event.amount <= 0n) return null;
      return event;
    } catch (e) {
      this.logger.error(`verifyVaultTransfer ${signature} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Current confirmed slot — used to pin a future targetSlot at round open (#101). */
  async currentSlot(): Promise<number | null> {
    if (!this.enabled) return null;
    try {
      return await this.connection.getSlot('confirmed');
    } catch {
      return null;
    }
  }

  /**
   * Hash of `targetSlot` from the SlotHashes sysvar (32-byte hex), or null if the
   * slot is not in the ~512-slot window (not yet reached, or rolled out) or the
   * read fails. The operator cannot predict/choose this at commit time (#101).
   * Sysvar layout: u64 LE count, then `count` entries of u64 LE slot + 32-byte hash.
   */
  async readSlotHash(targetSlot: number | bigint): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      const acct = await this.connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY);
      if (!acct) return null;
      const data = acct.data;
      const count = Number(data.readBigUInt64LE(0));
      const want = BigInt(targetSlot);
      for (let i = 0; i < count; i++) {
        const off = 8 + i * 40;
        if (data.readBigUInt64LE(off) === want) {
          return data.subarray(off + 8, off + 40).toString('hex');
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ settle

  /**
   * AUTHORITATIVE on-chain settlement (#26): moves real lamports between the
   * user vault and the house vault, then VERIFIES the confirmed transaction —
   * `meta.err == null` and the house-vault lamport delta equals the requested
   * net — before reporting success. Returns the tx signature only when the
   * value provably moved; null on failure/mismatch (callers must NOT credit a
   * mirror ledger off a null). Play-money receipts belong in `recordBet`.
   */
  async settleBet(params: {
    betId: string; // uuid — packed into 16 bytes
    walletAddress: string;
    game: 'crash' | 'coinflip' | 'blackjack' | 'lottery' | 'jackpot';
    stakeLamports: bigint;
    payoutLamports: bigint;
    multiplier: number | null;
  }): Promise<string | null> {
    if (!this.enabled || !this.cosigner) return null;
    // Pre-payout solvency guard (#54): on a win the house pays net; refuse if
    // that would breach the reserve floor (before the on-chain InsufficientFunds).
    const houseNet = params.payoutLamports - params.stakeLamports;
    if (!(await this.reserveCoversPayout(houseNet, 'settle'))) return null;
    try {
      const user = new PublicKey(params.walletAddress);
      const data = Buffer.concat([
        anchorDiscriminator('settle_bet'),
        uuidToBytes(params.betId),
        Buffer.from([GAME_INDEX[params.game]]),
        u64le(params.stakeLamports),
        u64le(params.payoutLamports),
        u32le(Math.round((params.multiplier ?? 0) * 10_000)),
      ]);
      const houseVault = this.houseVaultPda();
      const ix = new TransactionInstruction({
        programId: this.programId!,
        keys: [
          { pubkey: this.housePda(), isSigner: false, isWritable: false },
          { pubkey: houseVault, isSigner: false, isWritable: true },
          { pubkey: this.userVaultPda(user), isSigner: false, isWritable: true },
          { pubkey: user, isSigner: false, isWritable: false },
          // Cosigner pays rent when init_if_needed creates a fresh vault.
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });

      // Post-confirm verification: the receipt is only as good as the lamports
      // that actually moved. The HOUSE delta is rent-noise-free (the cosigner
      // pays any init_if_needed rent), so it must equal ±net exactly.
      const confirmed = await this.connection.getTransaction(sig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      const expectedHouseDelta =
        params.stakeLamports >= params.payoutLamports
          ? params.stakeLamports - params.payoutLamports // loss → house gains net
          : -(params.payoutLamports - params.stakeLamports); // win → house pays net
      if (!settlementMoved(confirmed, houseVault.toBase58(), expectedHouseDelta)) {
        this.logger.error(
          `settle_bet ${params.betId}: confirmed tx did not move the expected ` +
            `${expectedHouseDelta} lamports through the house vault — NOT reporting success`,
        );
        payoutFailedTotal.inc({ kind: 'settle' });
        return null;
      }
      return sig;
    } catch (e) {
      this.logger.error(`settle_bet failed for bet ${params.betId}: ${(e as Error).message}`);
      payoutFailedTotal.inc({ kind: 'settle' });
      return null;
    }
  }

  /**
   * Global on-chain kill-switch (#56): flips the vault `House.paused` flag so
   * settle_bet/claim_reward revert with `Paused`. No-op while the chain layer is
   * play-money/undeployed — the Redis global pause (MaintenanceService) is the
   * active kill-switch until the vault is live.
   * TODO(#56-followup): encode + cosigner-sign the `set_paused` instruction
   * (mirror settleBet) once the vault is deployed.
   */
  async setPaused(paused: boolean): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        `setPaused(${paused}) — chain disabled (play-money); on-chain pause is a no-op`,
      );
      return;
    }
    this.logger.warn(`setPaused(${paused}) — on-chain set_paused not yet wired (vault undeployed)`);
  }

  /**
   * PLAY-MONEY receipt (#26): records the bet outcome on chain WITHOUT moving
   * lamports (the program's `record_bet` — a separate instruction + event so a
   * value-bearing settlement can never be confused with a play-money record).
   * Fire-and-forget like the old receipt path: returns the signature or null.
   */
  async recordBet(params: {
    betId: string;
    walletAddress: string;
    game: 'crash' | 'coinflip' | 'blackjack' | 'lottery' | 'jackpot';
    stakeLamports: bigint;
    payoutLamports: bigint;
    multiplier: number | null;
  }): Promise<string | null> {
    if (!this.enabled || !this.cosigner) return null;
    try {
      const user = new PublicKey(params.walletAddress);
      const data = Buffer.concat([
        anchorDiscriminator('record_bet'),
        uuidToBytes(params.betId),
        Buffer.from([GAME_INDEX[params.game]]),
        u64le(params.stakeLamports),
        u64le(params.payoutLamports),
        u32le(Math.round((params.multiplier ?? 0) * 10_000)),
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId!,
        keys: [
          { pubkey: this.housePda(), isSigner: false, isWritable: false },
          { pubkey: user, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
        ],
        data,
      });
      const tx = new Transaction().add(ix);
      return await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });
    } catch (e) {
      this.logger.error(`record_bet failed for bet ${params.betId}: ${(e as Error).message}`);
      return null;
    }
  }

  // ------------------------------------------------------------ lottery

  private lotteryProgramId: PublicKey | null = null;

  // The lottery is denominated in $SCAD (the role CAKE plays in PancakeSwap):
  // tickets, prizes, burn and injection all move the SCAD mint.
  get lotteryEnabled(): boolean {
    return this.enabled && !!this.lotteryProgramId && !!this.scadMint;
  }
  get lotteryProgramIdBase58(): string | null {
    return this.lotteryProgramId?.toBase58() ?? null;
  }
  get scadMintBase58(): string | null {
    return this.scadMint?.toBase58() ?? null;
  }

  /** $SCAD sitting in the lottery prize treasury (config PDA's ATA) — the
   * solvency ceiling for a draw's declared prizes (#29). */
  async lotteryTreasuryBalance(): Promise<bigint> {
    if (!this.lotteryEnabled) return 0n;
    try {
      const ataAddr = ata(this.scadMint!, this.lotteryConfigPda());
      const bal = await this.connection.getTokenAccountBalance(ataAddr);
      return BigInt(bal.value.amount);
    } catch {
      return 0n;
    }
  }

  /** USDS sitting in the dividend treasury (house PDA's USDS ATA) — the
   * solvency ceiling for outstanding staker dividend claims (SCAD Engine). */
  async usdsTreasuryBalance(): Promise<bigint | null> {
    if (!this.enabled || !this.usdsMint) return null;
    try {
      const ataAddr = ata(this.usdsMint, this.housePda());
      const bal = await this.connection.getTokenAccountBalance(ataAddr);
      return BigInt(bal.value.amount);
    } catch {
      return null;
    }
  }

  lotteryConfigPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('lottery')], this.lotteryProgramId!)[0];
  }
  lotteryDrawPda(index: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('draw'), u64le(index)],
      this.lotteryProgramId!,
    )[0];
  }
  lotteryPayoutPda(index: bigint, winner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('payout'), u64le(index), winner.toBuffer()],
      this.lotteryProgramId!,
    )[0];
  }

  /** Publish the seed commitment on-chain before sales open, pinning the draw's
   * `target_slot` (#19b) so reveal can't grind over recent slots. */
  async lotteryCommitDraw(params: {
    drawIndex: bigint;
    serverSeedHashHex: string; // 64-char hex
    clientSeedHex: string; // 32-char hex (16 bytes) — padded to 32 bytes
    drawAtMs: number;
    targetSlot: bigint; // future slot pinned at commit; reveal derives from ITS hash
  }): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const clientSeed = Buffer.alloc(32);
      Buffer.from(params.clientSeedHex, 'utf8').copy(clientSeed); // utf8, zero-padded
      const data = Buffer.concat([
        anchorDiscriminator('commit_draw'),
        u64le(params.drawIndex),
        Buffer.from(params.serverSeedHashHex, 'hex'),
        clientSeed,
        i64le(BigInt(Math.floor(params.drawAtMs / 1000))),
        u64le(params.targetSlot),
      ]);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: this.lotteryConfigPda(), isSigner: false, isWritable: false },
          { pubkey: this.lotteryDrawPda(params.drawIndex), isSigner: false, isWritable: true },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      return await this.send(ix);
    } catch (e) {
      this.logger.error(`commit_draw ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Reveal the seed. The PROGRAM asserts sha256(seed)==commitment, requires the
   * SlotHashes entry for the slot PINNED at commit (`draw.target_slot`), mixes in
   * THAT hash, and derives the winning numbers itself — we read them back from
   * the Draw account afterwards (chain is the source of truth; the API no longer
   * dictates the numbers, and cannot grind which slot seeds the draw).
   */
  async lotteryRevealDraw(params: {
    drawIndex: bigint;
    serverSeedHex: string; // 64-char hex → 64 utf8 bytes on-chain
  }): Promise<{
    signature: string;
    digits: number[];
    slotHashHex: string;
    finalEntropyHex: string;
  } | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const data = Buffer.concat([
        anchorDiscriminator('reveal_draw'),
        u64le(params.drawIndex),
        Buffer.from(params.serverSeedHex, 'utf8'),
      ]);
      const drawPda = this.lotteryDrawPda(params.drawIndex);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: this.lotteryConfigPda(), isSigner: false, isWritable: false },
          { pubkey: drawPda, isSigner: false, isWritable: true },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        ],
        data,
      });
      const signature = await this.send(ix);

      // Draw layout after the 8-byte discriminator (programs/scadium_lottery):
      // index u64 | seed_hash 32 | client_seed 32 | revealed_seed 64 |
      // slot u64 | slot_hash 32 | final_entropy 32 | winning_digits 6 | …
      const info = await this.connection.getAccountInfo(drawPda, 'confirmed');
      if (!info) throw new Error('Draw account missing after reveal');
      const buf = info.data;
      const slotHashHex = buf.subarray(152, 184).toString('hex');
      const finalEntropyHex = buf.subarray(184, 216).toString('hex');
      const digits = Array.from(buf.subarray(216, 222));
      return { signature, digits, slotHashHex, finalEntropyHex };
    } catch (e) {
      this.logger.error(`reveal_draw ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Pay a winner its equal share of a bracket's $SCAD slice (idempotent via the Payout PDA). */
  async lotteryPayPrize(params: {
    drawIndex: bigint;
    walletAddress: string;
    amountScadBase: bigint;
    bracket: number;
  }): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const winner = new PublicKey(params.walletAddress);
      const config = this.lotteryConfigPda();
      const data = Buffer.concat([
        anchorDiscriminator('pay_prize'),
        u64le(params.drawIndex),
        u64le(params.amountScadBase),
        Buffer.from([params.bracket]),
      ]);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: this.lotteryDrawPda(params.drawIndex), isSigner: false, isWritable: false },
          { pubkey: winner, isSigner: false, isWritable: false },
          {
            pubkey: this.lotteryPayoutPda(params.drawIndex, winner),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: ata(this.scadMint!, config), isSigner: false, isWritable: true },
          { pubkey: ata(this.scadMint!, winner), isSigner: false, isWritable: true },
          { pubkey: this.scadMint!, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      return await this.send(ix);
    } catch (e) {
      this.logger.error(`pay_prize ${params.drawIndex} failed: ${(e as Error).message}`);
      payoutFailedTotal.inc({ kind: 'prize' });
      return null;
    }
  }

  /** Burn the round's treasury slice — a real $SCAD token burn (PancakeSwap treasuryFee). */
  async lotteryBurnPool(params: {
    drawIndex: bigint;
    amountScadBase: bigint;
  }): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner || params.amountScadBase <= BigInt(0)) return null;
    try {
      const config = this.lotteryConfigPda();
      const data = Buffer.concat([
        anchorDiscriminator('burn_pool'),
        u64le(params.drawIndex),
        u64le(params.amountScadBase),
      ]);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: this.lotteryDrawPda(params.drawIndex), isSigner: false, isWritable: false },
          { pubkey: ata(this.scadMint!, config), isSigner: false, isWritable: true },
          { pubkey: this.scadMint!, isSigner: false, isWritable: true },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
      });
      return await this.send(ix);
    } catch (e) {
      this.logger.error(`burn_pool ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Inject house $SCAD into a round's pool (PancakeSwap injection). */
  async lotteryInject(params: {
    drawIndex: bigint;
    amountScadBase: bigint;
  }): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner || params.amountScadBase <= BigInt(0)) return null;
    try {
      const config = this.lotteryConfigPda();
      const data = Buffer.concat([
        anchorDiscriminator('inject'),
        u64le(params.drawIndex),
        u64le(params.amountScadBase),
      ]);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: this.lotteryDrawPda(params.drawIndex), isSigner: false, isWritable: false },
          {
            pubkey: ata(this.scadMint!, this.cosigner.publicKey),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: ata(this.scadMint!, config), isSigner: false, isWritable: true },
          { pubkey: this.scadMint!, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
      });
      return await this.send(ix);
    } catch (e) {
      this.logger.error(`inject ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Devnet faucet: cosigner transfers demo $SCAD to a user. */
  async scadFaucet(walletAddress: string, amountBase: bigint): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const to = new PublicKey(walletAddress);
      const fromAta = ata(this.scadMint!, this.cosigner.publicKey);
      const toAta = ata(this.scadMint!, to);
      const ixs: TransactionInstruction[] = [];
      const exists = await this.connection.getAccountInfo(toAta);
      if (!exists) {
        // Create the recipient ATA (payer = cosigner).
        ixs.push(
          new TransactionInstruction({
            programId: ASSOCIATED_TOKEN_PROGRAM_ID,
            keys: [
              { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
              { pubkey: toAta, isSigner: false, isWritable: true },
              { pubkey: to, isSigner: false, isWritable: false },
              { pubkey: this.scadMint!, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([0]), // Create
          }),
        );
      }
      // SPL Token Transfer (ix index 3): [3, amount u64le]
      ixs.push(
        new TransactionInstruction({
          programId: TOKEN_PROGRAM_ID,
          keys: [
            { pubkey: fromAta, isSigner: false, isWritable: true },
            { pubkey: toAta, isSigner: false, isWritable: true },
            { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
          ],
          data: Buffer.concat([Buffer.from([3]), u64le(amountBase)]),
        }),
      );
      const tx = new Transaction().add(...ixs);
      return await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });
    } catch (e) {
      this.logger.error(`scad faucet failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Fetch + verify a buy_ticket tx: returns the TicketBought event fields. */
  /**
   * All TicketBought events in a purchase tx — `buy_ticket` emits one,
   * `buy_tickets` (bulk) one per pick. Order matches the on-chain batch.
   */
  async verifyTicketTx(signature: string): Promise<
    {
      drawIndex: bigint;
      buyer: string;
      digits: number[];
    }[]
  > {
    if (!this.lotteryEnabled) return [];
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta || tx.meta.err) return [];
      const disc = createHash('sha256').update('event:TicketBought').digest().subarray(0, 8);
      const events: { drawIndex: bigint; buyer: string; digits: number[] }[] = [];
      for (const log of tx.meta.logMessages ?? []) {
        if (!log.startsWith('Program data: ')) continue;
        const buf = Buffer.from(log.slice('Program data: '.length), 'base64');
        // event TicketBought: draw_index u64 | buyer 32 | digits[6]
        // (after the 8-byte event discriminator).
        if (buf.length < 8 + 8 + 32 + 6 || !buf.subarray(0, 8).equals(disc)) continue;
        events.push({
          drawIndex: buf.readBigUInt64LE(8),
          buyer: new PublicKey(buf.subarray(16, 48)).toBase58(),
          digits: Array.from(buf.subarray(48, 54)),
        });
      }
      return events;
    } catch (e) {
      this.logger.error(`verifyTicketTx failed: ${(e as Error).message}`);
      return [];
    }
  }

  private async send(ix: TransactionInstruction): Promise<string> {
    // Capture once: `cosigner` is a live getter off the custody provider, so a
    // rotation (reloadCosigner) could null it between a caller's guard and here.
    const cosigner = this.cosigner;
    if (!cosigner) throw new Error('send(): cosigner unavailable (rotation in progress?)');
    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [cosigner], {
      commitment: 'confirmed',
      maxRetries: 3,
    });
  }

  // ------------------------------------------------------------ rewards

  /**
   * Cosigner-signed $SCAD claim from the rewards treasury. `period` must be
   * unique per (user, kind) — it seeds the on-chain ClaimRecord PDA that
   * blocks double-claims. Returns the tx signature or null (disabled/error).
   */
  async claimReward(params: {
    walletAddress: string;
    kind: 'wagerReward' | 'cashback' | 'dailyCase' | 'airdrop';
    period: bigint;
    amountScadBase: bigint;
  }): Promise<string | null> {
    if (!this.enabled || !this.cosigner || !this.scadMint) return null;
    try {
      const user = new PublicKey(params.walletAddress);
      const kindIndex = REWARD_KIND_INDEX[params.kind];
      const periodLe = u64le(params.period);

      const house = this.housePda();
      const claimRecord = PublicKey.findProgramAddressSync(
        [Buffer.from('claim'), user.toBuffer(), Buffer.from([kindIndex]), periodLe],
        this.programId!,
      )[0];
      const treasuryAta = ata(this.scadMint, house);
      const userAta = ata(this.scadMint, user);

      const data = Buffer.concat([
        anchorDiscriminator('claim_reward'),
        Buffer.from([kindIndex]),
        periodLe,
        u64le(params.amountScadBase),
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId!,
        keys: [
          { pubkey: house, isSigner: false, isWritable: false },
          { pubkey: claimRecord, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: false, isWritable: false },
          { pubkey: treasuryAta, isSigner: false, isWritable: true },
          { pubkey: userAta, isSigner: false, isWritable: true },
          { pubkey: this.scadMint, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });
      return sig;
    } catch (e) {
      this.logger.error(
        `claim_reward failed for ${params.walletAddress} ${params.kind}/${params.period}: ${(e as Error).message}`,
      );
      payoutFailedTotal.inc({ kind: 'claim' });
      return null;
    }
  }

  /**
   * Cosigner-signed USDS dividend claim from the USDS treasury (SCAD Engine).
   * Mirrors {@link claimReward} but targets the USDS mint via the program's
   * `claim_dividend` instruction. `period` seeds the ClaimRecord PDA (with the
   * Dividend kind), blocking double-pays. Returns the tx signature or null.
   */
  async claimDividend(params: {
    walletAddress: string;
    period: bigint;
    amountUsdsBase: bigint;
  }): Promise<string | null> {
    if (!this.enabled || !this.cosigner || !this.usdsMint) return null;
    try {
      const user = new PublicKey(params.walletAddress);
      const kindIndex = REWARD_KIND_INDEX.dividend;
      const periodLe = u64le(params.period);

      const house = this.housePda();
      const claimRecord = PublicKey.findProgramAddressSync(
        [Buffer.from('claim'), user.toBuffer(), Buffer.from([kindIndex]), periodLe],
        this.programId!,
      )[0];
      const treasuryAta = ata(this.usdsMint, house);
      const userAta = ata(this.usdsMint, user);

      const data = Buffer.concat([
        anchorDiscriminator('claim_dividend'),
        periodLe,
        u64le(params.amountUsdsBase),
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId!,
        keys: [
          { pubkey: house, isSigner: false, isWritable: false },
          { pubkey: claimRecord, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: false, isWritable: false },
          { pubkey: treasuryAta, isSigner: false, isWritable: true },
          { pubkey: userAta, isSigner: false, isWritable: true },
          { pubkey: this.usdsMint, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });
      return sig;
    } catch (e) {
      this.logger.error(
        `claim_dividend failed for ${params.walletAddress} ${params.period}: ${(e as Error).message}`,
      );
      payoutFailedTotal.inc({ kind: 'dividend' });
      return null;
    }
  }

  get usdsMintBase58(): string | null {
    return this.usdsMint?.toBase58() ?? null;
  }
}

// ------------------------------------------------------------------ utils

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Associated token account address for (mint, owner). */
function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

const REWARD_KIND_INDEX: Record<string, number> = {
  wagerReward: 0,
  cashback: 1,
  dailyCase: 2,
  airdrop: 3,
  // SCAD Engine staker dividend (USDS) — matches the on-chain RewardKind order.
  dividend: 4,
};

const GAME_INDEX: Record<string, number> = {
  crash: 0,
  coinflip: 1,
  blackjack: 2,
  lottery: 3,
  jackpot: 4,
};

/** Anchor global instruction discriminator: sha256("global:<snake_name>")[0..8]. */
function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex'); // 16 bytes
}

function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function u32le(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
}

// SystemProgram import kept for upcoming deposit/withdraw tx builders (web-side
// signing happens in the browser; the API only ever signs with the cosigner).
void SystemProgram;
