//! scadium_lottery — bc.game-style 5/36+1/10 lottery, anchored on-chain.
//!
//! Trust model:
//! - Before ticket sales open, the server COMMITS sha256(serverSeed) into the
//!   Draw account (`commit_draw`). The seed itself stays secret.
//! - Tickets are USER-signed: 0.1 USDT moves from the buyer's ATA into the
//!   lottery treasury ATA and a `TicketBought` event records the picks —
//!   every ticket is an on-chain receipt.
//! - At draw time the server REVEALS the seed (`reveal_draw`); the program
//!   asserts `sha256(seed) == commitment`, mixes in the NEWEST SlotHashes
//!   entry — entropy that did not exist at commit time — and derives the
//!   winning numbers ITSELF (the cosigner cannot pick them). The byte layout
//!   is mirrored in packages/fair/src/lottery.ts and the browser verifier;
//!   a shared golden vector locks all three implementations together.
//! - Fixed prizes (house lottery, not parimutuel) are paid from the same
//!   treasury via cosigner-signed `pay_prize`, one event per winner.
//!
//! Known limitation (acceptable for the demo): the cosigner chooses WHEN to
//! send the reveal, so it can grind over recent slots. It still cannot pick
//! arbitrary numbers — each attempt costs a slot's worth of waiting and the
//! seed is committed — but a production deployment should pin a target slot
//! at commit time.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash as sha256;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};

declare_id!("3HHxLKiAW4JhSHaPSKpjCqCxpQgPfTd8pP6tzL8ZAVk5");

/// The SlotHashes sysvar account (anchor 1.0's prelude doesn't re-export its ID).
pub const SLOT_HASHES_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarS1otHashes111111111111111111111111111");

#[program]
pub mod scadium_lottery {
    use super::*;

    pub fn init_lottery(ctx: Context<InitLottery>, cosigner: Pubkey, ticket_price: u64) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.payer.key();
        cfg.cosigner = cosigner;
        cfg.usdt_mint = ctx.accounts.usdt_mint.key();
        cfg.ticket_price = ticket_price;
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

    /// USER-signed ticket purchase: 0.1 USDT → treasury, picks in the event.
    pub fn buy_ticket(
        ctx: Context<BuyTicket>,
        draw_index: u64,
        main: [u8; 5],
        bonus: u8,
    ) -> Result<()> {
        let draw = &mut ctx.accounts.draw;
        require!(draw.index == draw_index, LotteryError::WrongDraw);
        require!(draw.status == DrawStatus::Open, LotteryError::DrawClosed);
        require!(Clock::get()?.unix_timestamp < draw.draw_at, LotteryError::DrawClosed);
        validate_picks(&main, bonus)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.buyer_usdt.to_account_info(),
                    to: ctx.accounts.treasury_usdt.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            ctx.accounts.config.ticket_price,
        )?;
        draw.ticket_count += 1;

        emit!(TicketBought {
            draw_index,
            buyer: ctx.accounts.buyer.key(),
            main,
            bonus,
        });
        Ok(())
    }

    /// USER-signed BATCH purchase: up to [`MAX_TICKETS_PER_TX`] tickets in a
    /// single transaction — one USDT transfer of `n × price`, one
    /// `TicketBought` event per ticket (same shape as `buy_ticket`, so
    /// off-chain confirmation parses both identically).
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
            validate_picks(&p.main, p.bonus)?;
        }

        let total = ctx
            .accounts
            .config
            .ticket_price
            .checked_mul(n)
            .ok_or(LotteryError::ZeroAmount)?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.buyer_usdt.to_account_info(),
                    to: ctx.accounts.treasury_usdt.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            total,
        )?;
        draw.ticket_count += n as u32;

        let buyer = ctx.accounts.buyer.key();
        for p in picks {
            emit!(TicketBought { draw_index, buyer, main: p.main, bonus: p.bonus });
        }
        Ok(())
    }

    /// Cosigner reveals the seed; the program checks the commitment, reads
    /// the newest SlotHashes entry, and derives the winning numbers ITSELF —
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

        let (final_entropy, main, bonus) =
            derive_numbers(&server_seed, &slot_hash, &draw.client_seed, 0);

        draw.revealed_seed = server_seed;
        draw.slot = slot;
        draw.slot_hash = slot_hash;
        draw.final_entropy = final_entropy;
        draw.winning_main = main;
        draw.winning_bonus = bonus;
        draw.status = DrawStatus::Revealed;
        emit!(DrawRevealed {
            draw_index,
            server_seed,
            slot,
            slot_hash,
            final_entropy,
            main,
            bonus
        });
        Ok(())
    }

    /// Cosigner pays a fixed-tier prize from the treasury.
    pub fn pay_prize(
        ctx: Context<PayPrize>,
        draw_index: u64,
        amount: u64,
        tier: u8,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require_keys_eq!(ctx.accounts.cosigner.key(), cfg.cosigner, LotteryError::NotCosigner);
        require!(
            ctx.accounts.draw.status == DrawStatus::Revealed,
            LotteryError::DrawClosed
        );
        require!(amount > 0, LotteryError::ZeroAmount);

        let seeds: &[&[u8]] = &[b"lottery", &[cfg.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_usdt.to_account_info(),
                    to: ctx.accounts.winner_usdt.to_account_info(),
                    authority: cfg.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        emit!(PrizePaid {
            draw_index,
            winner: ctx.accounts.winner.key(),
            amount,
            tier,
        });
        Ok(())
    }
}

/// Max picks per `buy_tickets` transaction (compute-budget headroom; the
/// web client batches 12 per tx — see `LOTTERY.BATCH_TICKETS_PER_TX`).
pub const MAX_TICKETS_PER_TX: u64 = 20;

fn validate_picks(main: &[u8; 5], bonus: u8) -> Result<()> {
    let mut seen = [false; 37];
    for &n in main {
        require!((1..=36).contains(&n), LotteryError::InvalidPick);
        require!(!seen[n as usize], LotteryError::InvalidPick);
        seen[n as usize] = true;
    }
    require!((1..=10).contains(&bonus), LotteryError::InvalidPick);
    Ok(())
}

/// Canonical draw derivation — MUST stay byte-for-byte identical to
/// `packages/fair/src/lottery.ts` and `apps/web/src/lib/fair-browser.ts`
/// (golden-vector locked in all three test suites):
///
///   final_entropy = sha256(server_seed[64] || slot_hash[32] || client_seed[32] || u32le(nonce))
///   main slot i:    h = sha256(final_entropy || [0x6d, i]); r = u64_be(h[0..8]) % pool_len
///                   take pool[r] without replacement, then sort ascending
///   bonus:          h = sha256(final_entropy || [0x62]); u64_be(h[0..8]) % 10 + 1
fn derive_numbers(
    server_seed: &[u8; 64],
    slot_hash: &[u8; 32],
    client_seed: &[u8; 32],
    nonce: u32,
) -> ([u8; 32], [u8; 5], u8) {
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

    let mut pool: Vec<u8> = (1..=36).collect();
    let mut main = [0u8; 5];
    for (i, slot) in main.iter_mut().enumerate() {
        let r = (roll(&[0x6d, i as u8]) % pool.len() as u64) as usize;
        *slot = pool.remove(r);
    }
    main.sort_unstable();
    let bonus = (roll(&[0x62]) % 10) as u8 + 1;
    (entropy, main, bonus)
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
    pub main: [u8; 5],
    pub bonus: u8,
}

#[account]
pub struct LotteryConfig {
    pub authority: Pubkey,
    pub cosigner: Pubkey,
    pub usdt_mint: Pubkey,
    pub ticket_price: u64,
    pub bump: u8,
}
impl LotteryConfig {
    pub const SIZE: usize = 8 + 32 * 3 + 8 + 1;
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
    pub winning_main: [u8; 5],
    pub winning_bonus: u8,
    pub draw_at: i64,
    pub status: DrawStatus,
    pub ticket_count: u32,
    pub bump: u8,
}
impl Draw {
    pub const SIZE: usize = 8 + 8 + 32 + 32 + 64 + 8 + 32 + 32 + 5 + 1 + 8 + 1 + 4 + 1;
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitLottery<'info> {
    #[account(init, payer = payer, space = LotteryConfig::SIZE, seeds = [b"lottery"], bump)]
    pub config: Account<'info, LotteryConfig>,
    pub usdt_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = usdt_mint,
        associated_token::authority = config
    )]
    pub treasury_usdt: Account<'info, TokenAccount>,
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
pub struct BuyTicket<'info> {
    #[account(seeds = [b"lottery"], bump = config.bump)]
    pub config: Account<'info, LotteryConfig>,
    #[account(mut, seeds = [b"draw".as_ref(), &draw_index.to_le_bytes()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
    #[account(mut, associated_token::mint = usdt_mint, associated_token::authority = buyer)]
    pub buyer_usdt: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = usdt_mint, associated_token::authority = config)]
    pub treasury_usdt: Account<'info, TokenAccount>,
    #[account(address = config.usdt_mint)]
    pub usdt_mint: Account<'info, Mint>,
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
    #[account(mut, associated_token::mint = usdt_mint, associated_token::authority = config)]
    pub treasury_usdt: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = cosigner,
        associated_token::mint = usdt_mint,
        associated_token::authority = winner
    )]
    pub winner_usdt: Account<'info, TokenAccount>,
    #[account(address = config.usdt_mint)]
    pub usdt_mint: Account<'info, Mint>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
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
pub struct TicketBought {
    pub draw_index: u64,
    pub buyer: Pubkey,
    pub main: [u8; 5],
    pub bonus: u8,
}

#[event]
pub struct DrawRevealed {
    pub draw_index: u64,
    pub server_seed: [u8; 64],
    pub slot: u64,
    pub slot_hash: [u8; 32],
    pub final_entropy: [u8; 32],
    pub main: [u8; 5],
    pub bonus: u8,
}

#[event]
pub struct PrizePaid {
    pub draw_index: u64,
    pub winner: Pubkey,
    pub amount: u64,
    pub tier: u8,
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

        let (entropy, main, bonus) = derive_numbers(&server_seed, &slot_hash, &client_seed, 0);
        assert_eq!(
            hex(&entropy),
            "ce7775cad5c28b6fb81bb6a97692854adcd58595a0016badea8381e4fe62960d"
        );
        assert_eq!(main, [4, 15, 18, 19, 30]);
        assert_eq!(bonus, 2);
    }

    #[test]
    fn derived_numbers_are_always_valid_picks() {
        let server_seed: [u8; 64] = "ab".repeat(32).as_bytes().try_into().unwrap();
        for n in 0..200u32 {
            let slot_hash = sha256(&n.to_le_bytes()).to_bytes();
            let (_, main, bonus) = derive_numbers(&server_seed, &slot_hash, &[7u8; 32], 0);
            validate_picks(&main, bonus).expect("derived picks must satisfy validate_picks");
            assert!(main.windows(2).all(|w| w[0] < w[1]), "sorted & distinct");
        }
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
