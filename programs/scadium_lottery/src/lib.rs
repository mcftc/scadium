//! scadium_lottery — bc.game-style 5/36+1/10 lottery, anchored on-chain.
//!
//! Trust model:
//! - Before ticket sales open, the server COMMITS sha256(serverSeed) into the
//!   Draw account (`commit_draw`). The seed itself stays secret.
//! - Tickets are USER-signed: 0.1 USDT moves from the buyer's ATA into the
//!   lottery treasury ATA and a `TicketBought` event records the picks —
//!   every ticket is an on-chain receipt.
//! - At draw time the server REVEALS the seed (`reveal_draw`); the program
//!   asserts `sha256(seed) == commitment` and stores the winning numbers.
//!   Anyone can re-run the public HMAC expansion (packages/fair) to verify
//!   the numbers follow from the committed seed.
//! - Fixed prizes (house lottery, not parimutuel) are paid from the same
//!   treasury via cosigner-signed `pay_prize`, one event per winner.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hash as sha256;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};

declare_id!("3HHxLKiAW4JhSHaPSKpjCqCxpQgPfTd8pP6tzL8ZAVk5");

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

    /// Cosigner reveals the seed; the program checks the commitment and
    /// pins the winning numbers on-chain.
    pub fn reveal_draw(
        ctx: Context<RevealDraw>,
        draw_index: u64,
        server_seed: [u8; 64], // utf8 hex of the 32-byte seed (matches commit)
        main: [u8; 5],
        bonus: u8,
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
        validate_picks(&main, bonus)?;

        draw.revealed_seed = server_seed;
        draw.winning_main = main;
        draw.winning_bonus = bonus;
        draw.status = DrawStatus::Revealed;
        emit!(DrawRevealed { draw_index, server_seed, main, bonus });
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

// ---------------------------------------------------------------- state

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DrawStatus {
    Open,
    Revealed,
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
    pub winning_main: [u8; 5],
    pub winning_bonus: u8,
    pub draw_at: i64,
    pub status: DrawStatus,
    pub ticket_count: u32,
    pub bump: u8,
}
impl Draw {
    pub const SIZE: usize = 8 + 8 + 32 + 32 + 64 + 5 + 1 + 8 + 1 + 4 + 1;
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
}
