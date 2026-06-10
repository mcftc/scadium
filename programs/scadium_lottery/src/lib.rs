//! scadium_lottery — PancakeSwap-v2 style 6-digit lottery, anchored on-chain,
//! denominated in $SCAD (the role CAKE plays in PancakeSwap).
//!
//! Game: a ticket is a 6-digit number, each digit 0..9. The program derives a
//! single 6-digit winning number; a ticket wins the HIGHEST bracket whose
//! leading digits all match LEFT-TO-RIGHT (match-first-1 .. match-first-6).
//!
//! Trust model:
//! - Before ticket sales open, the server COMMITS sha256(serverSeed) into the
//!   Draw account (`commit_draw`). The seed itself stays secret.
//! - Tickets are USER-signed: `ticket_price` $SCAD (with a PancakeSwap bulk
//!   discount for batches) moves from the buyer's ATA into the lottery treasury
//!   ATA and a `TicketBought` event records the picks — every ticket is an
//!   on-chain receipt.
//! - At draw time the server REVEALS the seed (`reveal_draw`); the program
//!   asserts `sha256(seed) == commitment`, mixes in the NEWEST SlotHashes
//!   entry — entropy that did not exist at commit time — and derives the
//!   6-digit winning number ITSELF (the cosigner cannot pick it). The byte
//!   layout is mirrored in packages/fair/src/lottery.ts and the browser
//!   verifier; a shared golden vector locks all three implementations together.
//! - The round pool (ticket sales + injection + carried rollover) is split per
//!   bracket off-chain; the cosigner pays each winner its equal share via
//!   `pay_prize` (idempotent per (draw, winner) via a `Payout` PDA), burns the
//!   20% treasury slice via `burn_pool` (a real SPL token burn — like CAKE),
//!   and tops up the pool each round via `inject`.
//!
//! Known limitation (acceptable for the demo): the cosigner chooses WHEN to
//! send the reveal, so it can grind over recent slots. It still cannot pick an
//! arbitrary number — each attempt costs a slot's worth of waiting and the seed
//! is committed — but a production deployment should pin a target slot at
//! commit time.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash as sha256;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer as SplTransfer};

declare_id!("3HHxLKiAW4JhSHaPSKpjCqCxpQgPfTd8pP6tzL8ZAVk5");

/// The SlotHashes sysvar account (anchor 1.0's prelude doesn't re-export its ID).
pub const SLOT_HASHES_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarS1otHashes111111111111111111111111111");

/// Number of digits in a ticket / winning number.
pub const LOTTERY_DIGITS: usize = 6;

#[program]
pub mod scadium_lottery {
    use super::*;

    pub fn init_lottery(
        ctx: Context<InitLottery>,
        cosigner: Pubkey,
        ticket_price: u64,
        discount_divisor: u64,
    ) -> Result<()> {
        require!(discount_divisor >= MAX_TICKETS_PER_TX, LotteryError::InvalidConfig);
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.payer.key();
        cfg.cosigner = cosigner;
        cfg.scad_mint = ctx.accounts.scad_mint.key();
        cfg.ticket_price = ticket_price;
        cfg.discount_divisor = discount_divisor;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Cosigner publishes the seed commitment before sales open.
    pub fn commit_draw(
        ctx: Context<CommitDraw>,
        draw_index: u64,
        server_seed_hash: [u8; 32],
        client_seed: [u8; 32],
        draw_at: i64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            ctx.accounts.config.cosigner,
            LotteryError::NotCosigner
        );
        let draw = &mut ctx.accounts.draw;
        draw.index = draw_index;
        draw.server_seed_hash = server_seed_hash;
        draw.client_seed = client_seed;
        draw.draw_at = draw_at;
        draw.status = DrawStatus::Open;
        draw.ticket_count = 0;
        draw.bump = ctx.bumps.draw;
        emit!(DrawCommitted { draw_index, server_seed_hash, client_seed, draw_at });
        Ok(())
    }

    /// Cosigner tops up a round's pool with house $SCAD (PancakeSwap injection).
    pub fn inject(ctx: Context<Inject>, draw_index: u64, amount: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.cosigner.key(), cfg.cosigner, LotteryError::NotCosigner);
        require!(ctx.accounts.draw.index == draw_index, LotteryError::WrongDraw);
        require!(amount > 0, LotteryError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.injector_scad.to_account_info(),
                    to: ctx.accounts.treasury_scad.to_account_info(),
                    authority: ctx.accounts.cosigner.to_account_info(),
                },
            ),
            amount,
        )?;
        emit!(FundsInjected { draw_index, amount });
        Ok(())
    }

    /// USER-signed ticket purchase: `ticket_price` $SCAD → treasury, picks in the event.
    pub fn buy_ticket(ctx: Context<BuyTicket>, draw_index: u64, digits: [u8; 6]) -> Result<()> {
        let draw = &mut ctx.accounts.draw;
        require!(draw.index == draw_index, LotteryError::WrongDraw);
        require!(draw.status == DrawStatus::Open, LotteryError::DrawClosed);
        require!(Clock::get()?.unix_timestamp < draw.draw_at, LotteryError::DrawClosed);
        validate_picks(&digits)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.buyer_scad.to_account_info(),
                    to: ctx.accounts.treasury_scad.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            ctx.accounts.config.ticket_price,
        )?;
        draw.ticket_count += 1;

        emit!(TicketBought { draw_index, buyer: ctx.accounts.buyer.key(), digits });
        Ok(())
    }

    /// USER-signed BATCH purchase: up to [`MAX_TICKETS_PER_TX`] tickets in a
    /// single transaction — one $SCAD transfer of the PancakeSwap bulk-discount
    /// total, one `TicketBought` event per ticket (same shape as `buy_ticket`,
    /// so off-chain confirmation parses both identically).
    pub fn buy_tickets(
        ctx: Context<BuyTicket>,
        draw_index: u64,
        picks: Vec<TicketPick>,
    ) -> Result<()> {
        let n = picks.len() as u64;
        require!(n >= 1 && n <= MAX_TICKETS_PER_TX, LotteryError::TooManyTickets);
        let draw = &mut ctx.accounts.draw;
        require!(draw.index == draw_index, LotteryError::WrongDraw);
        require!(draw.status == DrawStatus::Open, LotteryError::DrawClosed);
        require!(Clock::get()?.unix_timestamp < draw.draw_at, LotteryError::DrawClosed);
        for p in &picks {
            validate_picks(&p.digits)?;
        }

        let total = bulk_discount_total(
            ctx.accounts.config.ticket_price,
            n,
            ctx.accounts.config.discount_divisor,
        )?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.buyer_scad.to_account_info(),
                    to: ctx.accounts.treasury_scad.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            total,
        )?;
        draw.ticket_count += n as u32;

        let buyer = ctx.accounts.buyer.key();
        for p in picks {
            emit!(TicketBought { draw_index, buyer, digits: p.digits });
        }
        Ok(())
    }

    /// Cosigner reveals the seed; the program checks the commitment, reads the
    /// newest SlotHashes entry, and derives the 6-digit winning number ITSELF —
    /// the cosigner only supplies the preimage of its own commitment.
    pub fn reveal_draw(
        ctx: Context<RevealDraw>,
        draw_index: u64,
        server_seed: [u8; 64], // utf8 hex of the 32-byte seed (matches commit)
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            ctx.accounts.config.cosigner,
            LotteryError::NotCosigner
        );
        let draw = &mut ctx.accounts.draw;
        require!(draw.index == draw_index, LotteryError::WrongDraw);
        require!(draw.status == DrawStatus::Open, LotteryError::DrawClosed);
        require!(
            sha256(&server_seed).to_bytes() == draw.server_seed_hash,
            LotteryError::SeedMismatch
        );

        // Newest SlotHashes entry: raw layout is u64 count, then
        // (u64 slot, [u8;32] hash) pairs, most recent first.
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        require!(data.len() >= 48, LotteryError::SlotHashUnavailable);
        let count = u64::from_le_bytes(data[0..8].try_into().unwrap());
        require!(count > 0, LotteryError::SlotHashUnavailable);
        let slot = u64::from_le_bytes(data[8..16].try_into().unwrap());
        let mut slot_hash = [0u8; 32];
        slot_hash.copy_from_slice(&data[16..48]);
        drop(data);

        let (final_entropy, digits) =
            derive_numbers(&server_seed, &slot_hash, &draw.client_seed, 0);

        draw.revealed_seed = server_seed;
        draw.slot = slot;
        draw.slot_hash = slot_hash;
        draw.final_entropy = final_entropy;
        draw.winning_digits = digits;
        draw.status = DrawStatus::Revealed;
        emit!(DrawRevealed {
            draw_index,
            server_seed,
            slot,
            slot_hash,
            final_entropy,
            digits,
        });
        Ok(())
    }

    /// Cosigner pays a winner its (equal) share of a bracket's slice. Idempotent
    /// per (draw, winner): the `Payout` PDA `init` fails on a replay.
    pub fn pay_prize(
        ctx: Context<PayPrize>,
        draw_index: u64,
        amount: u64,
        bracket: u8,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.cosigner.key(), cfg.cosigner, LotteryError::NotCosigner);
        require!(
            ctx.accounts.draw.status == DrawStatus::Revealed,
            LotteryError::DrawClosed
        );
        require!(amount > 0, LotteryError::ZeroAmount);
        require!((bracket as usize) < LOTTERY_DIGITS, LotteryError::InvalidBracket);

        let seeds: &[&[u8]] = &[b"lottery", &[cfg.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_scad.to_account_info(),
                    to: ctx.accounts.winner_scad.to_account_info(),
                    authority: cfg.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        let payout = &mut ctx.accounts.payout;
        payout.draw_index = draw_index;
        payout.winner = ctx.accounts.winner.key();
        payout.bracket = bracket;
        payout.amount = amount;
        payout.bump = ctx.bumps.payout;

        emit!(PrizePaid {
            draw_index,
            winner: ctx.accounts.winner.key(),
            amount,
            bracket,
        });
        Ok(())
    }

    /// Cosigner burns the round's treasury slice (PancakeSwap's treasuryFee) —
    /// a real SPL token burn that reduces $SCAD supply, like CAKE's burn.
    pub fn burn_pool(ctx: Context<BurnPool>, draw_index: u64, amount: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.cosigner.key(), cfg.cosigner, LotteryError::NotCosigner);
        require!(
            ctx.accounts.draw.status == DrawStatus::Revealed,
            LotteryError::DrawClosed
        );
        require!(amount > 0, LotteryError::ZeroAmount);

        let seeds: &[&[u8]] = &[b"lottery", &[cfg.bump]];
        token::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.scad_mint.to_account_info(),
                    from: ctx.accounts.treasury_scad.to_account_info(),
                    authority: cfg.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        emit!(PoolBurned { draw_index, amount });
        Ok(())
    }
}

/// Max picks per `buy_tickets` transaction (compute-budget headroom; the web
/// client batches `LOTTERY.BATCH_TICKETS_PER_TX` per tx). PancakeSwap allows up
/// to 100 per purchase via multi-tx chunking off-chain.
pub const MAX_TICKETS_PER_TX: u64 = 20;

fn validate_picks(digits: &[u8; 6]) -> Result<()> {
    for &d in digits {
        require!(d <= 9, LotteryError::InvalidPick);
    }
    Ok(())
}

/// PancakeSwap bulk-discount total (integer math):
///   total = price · n · (discount_divisor + 1 − n) / discount_divisor
fn bulk_discount_total(price: u64, n: u64, discount_divisor: u64) -> Result<u64> {
    require!(discount_divisor >= n, LotteryError::TooManyTickets);
    let total = (price as u128)
        .checked_mul(n as u128)
        .and_then(|x| x.checked_mul((discount_divisor as u128) + 1 - (n as u128)))
        .map(|x| x / (discount_divisor as u128))
        .ok_or(LotteryError::ZeroAmount)?;
    u64::try_from(total).map_err(|_| LotteryError::ZeroAmount.into())
}

/// Canonical draw derivation — MUST stay byte-for-byte identical to
/// `packages/fair/src/lottery.ts` and `apps/web/src/lib/fair-browser.ts`
/// (golden-vector locked in all three test suites):
///
///   final_entropy = sha256(server_seed[64] || slot_hash[32] || client_seed[32] || u32le(nonce))
///   digit i (0..5): h = sha256(final_entropy || [0x64, i]); digit = u64_be(h[0..8]) % 10
///   digit 0 is the leftmost (most-significant) digit of the winning number.
fn derive_numbers(
    server_seed: &[u8; 64],
    slot_hash: &[u8; 32],
    client_seed: &[u8; 32],
    nonce: u32,
) -> ([u8; 32], [u8; 6]) {
    let mut buf = [0u8; 64 + 32 + 32 + 4];
    buf[0..64].copy_from_slice(server_seed);
    buf[64..96].copy_from_slice(slot_hash);
    buf[96..128].copy_from_slice(client_seed);
    buf[128..132].copy_from_slice(&nonce.to_le_bytes());
    let entropy = sha256(&buf).to_bytes();

    let roll = |tag: &[u8]| -> u64 {
        let mut m = [0u8; 34];
        m[0..32].copy_from_slice(&entropy);
        m[32..32 + tag.len()].copy_from_slice(tag);
        let h = sha256(&m[..32 + tag.len()]).to_bytes();
        u64::from_be_bytes(h[0..8].try_into().unwrap())
    };

    let mut digits = [0u8; 6];
    for (i, d) in digits.iter_mut().enumerate() {
        *d = (roll(&[0x64, i as u8]) % 10) as u8;
    }
    (entropy, digits)
}

// ---------------------------------------------------------------- state

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DrawStatus {
    Open,
    Revealed,
}

/// One ticket's picks inside a `buy_tickets` batch.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TicketPick {
    pub digits: [u8; 6],
}

#[account]
pub struct LotteryConfig {
    pub authority: Pubkey,
    pub cosigner: Pubkey,
    pub scad_mint: Pubkey,
    pub ticket_price: u64,
    pub discount_divisor: u64,
    pub bump: u8,
}
impl LotteryConfig {
    pub const SIZE: usize = 8 + 32 * 3 + 8 + 8 + 1;
}

#[account]
pub struct Draw {
    pub index: u64,
    pub server_seed_hash: [u8; 32],
    pub client_seed: [u8; 32],
    pub revealed_seed: [u8; 64],
    pub slot: u64,             // slot whose hash seeded the draw
    pub slot_hash: [u8; 32],   // the SlotHashes entry mixed into final_entropy
    pub final_entropy: [u8; 32],
    pub winning_digits: [u8; 6],
    pub draw_at: i64,
    pub status: DrawStatus,
    pub ticket_count: u32,
    pub bump: u8,
}
impl Draw {
    pub const SIZE: usize = 8 + 8 + 32 + 32 + 64 + 8 + 32 + 32 + 6 + 8 + 1 + 4 + 1;
}

/// Idempotency + audit record for a paid prize (one per draw+winner).
#[account]
pub struct Payout {
    pub draw_index: u64,
    pub winner: Pubkey,
    pub bracket: u8,
    pub amount: u64,
    pub bump: u8,
}
impl Payout {
    pub const SIZE: usize = 8 + 8 + 32 + 1 + 8 + 1;
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitLottery<'info> {
    #[account(init, payer = payer, space = LotteryConfig::SIZE, seeds = [b"lottery"], bump)]
    pub config: Account<'info, LotteryConfig>,
    pub scad_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = scad_mint,
        associated_token::authority = config
    )]
    pub treasury_scad: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draw_index: u64)]
pub struct CommitDraw<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(
        init,
        payer = cosigner,
        space = Draw::SIZE,
        seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()],
        bump
    )]
    pub draw: Account<'info, Draw>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draw_index: u64)]
pub struct Inject<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = cosigner)]
    pub injector_scad: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = config)]
    pub treasury_scad: Account<'info, TokenAccount>,
    #[account(address = config.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(draw_index: u64)]
pub struct BuyTicket<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(mut, seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = buyer)]
    pub buyer_scad: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = config)]
    pub treasury_scad: Account<'info, TokenAccount>,
    #[account(address = config.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(draw_index: u64)]
pub struct RevealDraw<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(mut, seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    pub cosigner: Signer<'info>,
    /// CHECK: address-asserted SlotHashes sysvar; raw bytes parsed manually
    /// (the full sysvar is too large for Anchor's typed deserialization).
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(draw_index: u64)]
pub struct PayPrize<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    /// CHECK: prize recipient — ATA authority + event field only.
    pub winner: UncheckedAccount<'info>,
    #[account(
        init,
        payer = cosigner,
        space = Payout::SIZE,
        seeds = [b"payout".as_ref(), &draw_index.to_le_bytes(), winner.key().as_ref()],
        bump
    )]
    pub payout: Account<'info, Payout>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = config)]
    pub treasury_scad: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = cosigner,
        associated_token::mint = scad_mint,
        associated_token::authority = winner
    )]
    pub winner_scad: Account<'info, TokenAccount>,
    #[account(address = config.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draw_index: u64)]
pub struct BurnPool<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = config)]
    pub treasury_scad: Account<'info, TokenAccount>,
    #[account(mut, address = config.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct DrawCommitted {
    pub draw_index: u64,
    pub server_seed_hash: [u8; 32],
    pub client_seed: [u8; 32],
    pub draw_at: i64,
}

#[event]
pub struct FundsInjected {
    pub draw_index: u64,
    pub amount: u64,
}

#[event]
pub struct TicketBought {
    pub draw_index: u64,
    pub buyer: Pubkey,
    pub digits: [u8; 6],
}

#[event]
pub struct DrawRevealed {
    pub draw_index: u64,
    pub server_seed: [u8; 64],
    pub slot: u64,
    pub slot_hash: [u8; 32],
    pub final_entropy: [u8; 32],
    pub digits: [u8; 6],
}

#[event]
pub struct PrizePaid {
    pub draw_index: u64,
    pub winner: Pubkey,
    pub amount: u64,
    pub bracket: u8,
}

#[event]
pub struct PoolBurned {
    pub draw_index: u64,
    pub amount: u64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum LotteryError {
    #[msg("Signer is not the registered cosigner")]
    NotCosigner,
    #[msg("Draw index mismatch")]
    WrongDraw,
    #[msg("Draw is not open")]
    DrawClosed,
    #[msg("Revealed seed does not match the commitment")]
    SeedMismatch,
    #[msg("Invalid number picks")]
    InvalidPick,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Too many tickets in one transaction")]
    TooManyTickets,
    #[msg("SlotHashes sysvar is empty or unreadable")]
    SlotHashUnavailable,
    #[msg("Invalid lottery configuration")]
    InvalidConfig,
    #[msg("Bracket out of range")]
    InvalidBracket,
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    /// GOLDEN VECTOR — identical inputs/outputs are asserted in
    /// packages/fair/src/lottery.test.ts and the browser verifier. Never
    /// change one without the others.
    #[test]
    fn golden_vector_lockstep() {
        let server_seed: [u8; 64] = "deadbeef".repeat(8).as_bytes().try_into().unwrap();
        let mut client_seed = [0u8; 32];
        client_seed[..16].copy_from_slice(b"cafebabe12345678");
        let slot_hash: [u8; 32] = core::array::from_fn(|i| i as u8);

        let (entropy, digits) = derive_numbers(&server_seed, &slot_hash, &client_seed, 0);
        assert_eq!(
            hex(&entropy),
            "ce7775cad5c28b6fb81bb6a97692854adcd58595a0016badea8381e4fe62960d"
        );
        assert_eq!(digits, [5, 1, 9, 7, 3, 3]);
    }

    /// Consume the SHARED cross-impl fixture so a divergence between the Rust
    /// program and the Node/browser engines (packages/fair/src/__fixtures__/
    /// golden.json) fails CI. The fixture is generated from @scadium/fair; this
    /// proves the on-chain `derive_numbers` stays byte-identical to it.
    #[test]
    fn shared_golden_fixture_lockstep() {
        const FIXTURE: &str =
            include_str!("../../../packages/fair/src/__fixtures__/golden.json");
        let json: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let vectors = json["vectors"].as_array().expect("vectors array");
        assert!(!vectors.is_empty(), "fixture must contain vectors");

        for v in vectors {
            let label = v["label"].as_str().unwrap_or("?");

            let server_seed: [u8; 64] = v["serverSeed"]
                .as_str()
                .unwrap()
                .as_bytes()
                .try_into()
                .unwrap_or_else(|_| panic!("serverSeed must be 64 bytes ({label})"));

            let mut client_seed = [0u8; 32];
            let cs = v["clientSeed"].as_str().unwrap().as_bytes();
            assert!(cs.len() <= 32, "clientSeed must be ≤ 32 bytes ({label})");
            client_seed[..cs.len()].copy_from_slice(cs);

            let slot_hash = decode_hex32(v["slotHashHex"].as_str().unwrap());
            let nonce = v["nonce"].as_u64().unwrap() as u32;

            let (entropy, digits) = derive_numbers(&server_seed, &slot_hash, &client_seed, nonce);

            assert_eq!(
                hex(&entropy),
                v["lottery"]["entropyHex"].as_str().unwrap(),
                "entropy mismatch for {label}"
            );
            let expected: Vec<u8> = v["lottery"]["digits"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| d.as_u64().unwrap() as u8)
                .collect();
            assert_eq!(digits.to_vec(), expected, "digits mismatch for {label}");
        }
    }

    fn decode_hex32(s: &str) -> [u8; 32] {
        assert_eq!(s.len(), 64, "slot hash must be 64 hex chars");
        core::array::from_fn(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap())
    }

    #[test]
    fn derived_numbers_are_always_valid_picks() {
        let server_seed: [u8; 64] = "ab".repeat(32).as_bytes().try_into().unwrap();
        for n in 0..200u32 {
            let slot_hash = sha256(&n.to_le_bytes()).to_bytes();
            let (_, digits) = derive_numbers(&server_seed, &slot_hash, &[7u8; 32], 0);
            validate_picks(&digits).expect("derived digits must satisfy validate_picks");
            assert!(digits.iter().all(|&d| d <= 9), "digits in 0..9");
        }
    }

    #[test]
    fn bulk_discount_matches_pancakeswap_formula() {
        // 10 SCAD ticket, divisor 2000
        let price = 10_000_000_000u64;
        assert_eq!(bulk_discount_total(price, 1, 2000).unwrap(), price);
        // n=100 → price·100·(2000+1-100)/2000 = price·100·1901/2000
        let expected = (price as u128 * 100 * 1901 / 2000) as u64;
        assert_eq!(bulk_discount_total(price, 100, 2000).unwrap(), expected);
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
