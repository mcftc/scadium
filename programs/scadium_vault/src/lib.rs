//! scadium_vault — custody + settlement + $SCAD reward claims.
//!
//! Trust model (mirrors the plan):
//! - `deposit` / `withdraw` are USER-signed. Withdraw checks only
//!   `user_vault.owner == signer`, so the server can never freeze funds.
//! - `settle_bet` is COSIGNER-signed (server hot key registered in `House`).
//!   It can only net stake↔payout between a UserVault and the HouseVault —
//!   there is no path for the cosigner to move user funds anywhere else.
//! - Bet records are Anchor events (no rent), visible in the tx on Solscan;
//!   Postgres stays the queryable history keyed by `bet_id`.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer};

declare_id!("DSQJ8FX8JGhB2nKPGVM2ptWZydskNmp8629C8HXTvrqr");

#[program]
pub mod scadium_vault {
    use super::*;

    pub fn init_house(ctx: Context<InitHouse>, cosigner: Pubkey) -> Result<()> {
        let house = &mut ctx.accounts.house;
        house.authority = ctx.accounts.authority.key();
        house.cosigner = cosigner;
        house.scad_mint = ctx.accounts.scad_mint.key();
        house.paused = false;
        house.bump = ctx.bumps.house;
        house.vault_bump = ctx.bumps.house_vault;
        Ok(())
    }

    /// User-signed: move SOL from the user's wallet into their vault PDA.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let vault = &mut ctx.accounts.user_vault;
        if vault.owner == Pubkey::default() {
            vault.owner = ctx.accounts.user.key();
            vault.bump = ctx.bumps.user_vault;
        }
        require_keys_eq!(vault.owner, ctx.accounts.user.key(), VaultError::NotVaultOwner);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: vault.to_account_info(),
                },
            ),
            amount,
        )?;
        emit!(Deposited {
            user: vault.owner,
            amount,
            vault_balance: vault.to_account_info().lamports(),
        });
        Ok(())
    }

    /// User-signed ONLY. The non-custodial guarantee: nothing but the owner's
    /// signature is required, and rent-exemption is preserved.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let vault = &ctx.accounts.user_vault;
        require_keys_eq!(vault.owner, ctx.accounts.user.key(), VaultError::NotVaultOwner);

        let rent_min = Rent::get()?.minimum_balance(UserVault::SIZE);
        let available = vault
            .to_account_info()
            .lamports()
            .saturating_sub(rent_min);
        require!(amount <= available, VaultError::InsufficientFunds);

        vault.sub_lamports(amount)?;
        ctx.accounts.user.add_lamports(amount)?;
        emit!(Withdrawn {
            user: vault.owner,
            amount,
            vault_balance: vault.to_account_info().lamports(),
        });
        Ok(())
    }

    /// Cosigner-signed AUTHORITATIVE settlement (#26): nets stake vs payout
    /// between the user vault and the house vault, moving REAL lamports. The
    /// BetSettled event amounts are guaranteed equal to the value netted — a
    /// loss the vault cannot cover above rent REVERTS (InsufficientFunds)
    /// instead of emitting a full-amount receipt for a partial/zero transfer.
    /// Play-money rounds must use `record_bet` (an explicitly non-value
    /// receipt) instead.
    pub fn settle_bet(
        ctx: Context<SettleBet>,
        bet_id: [u8; 16],
        game: GameType,
        stake: u64,
        payout: u64,
        multiplier_bps: u32,
    ) -> Result<()> {
        let house = &ctx.accounts.house;
        require!(!house.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            house.cosigner,
            VaultError::NotCosigner
        );

        // First touch (init_if_needed) — bind the vault to its owner.
        if ctx.accounts.user_vault.owner == Pubkey::default() {
            ctx.accounts.user_vault.owner = ctx.accounts.user.key();
            ctx.accounts.user_vault.bump = ctx.bumps.user_vault;
        }
        require_keys_eq!(
            ctx.accounts.user_vault.owner,
            ctx.accounts.user.key(),
            VaultError::NotVaultOwner
        );

        let user_vault_info = ctx.accounts.user_vault.to_account_info();
        let house_vault_info = ctx.accounts.house_vault.to_account_info();
        let user_rent_min = Rent::get()?.minimum_balance(UserVault::SIZE);

        if payout >= stake {
            // House pays the net win — never below the house vault's own rent
            // floor (#30): the bankroll account must stay rent-exempt, so the
            // spendable house balance is lamports − rent_min.
            let net = payout - stake;
            if net > 0 {
                let house_rent_min = Rent::get()?.minimum_balance(0);
                let house_available =
                    house_vault_info.lamports().saturating_sub(house_rent_min);
                require!(house_available >= net, VaultError::InsufficientFunds);
                ctx.accounts.house_vault.sub_lamports(net)?;
                ctx.accounts.user_vault.add_lamports(net)?;
            }
        } else {
            // House collects the net loss — IN FULL. No clamp: if the vault
            // cannot cover the loss above rent the settlement reverts, so the
            // emitted receipt can never exceed the lamports actually moved.
            let net = stake - payout;
            if net > 0 {
                let available = user_vault_info.lamports().saturating_sub(user_rent_min);
                require!(available >= net, VaultError::InsufficientFunds);
                ctx.accounts.user_vault.sub_lamports(net)?;
                ctx.accounts.house_vault.add_lamports(net)?;
            }
        }

        emit!(BetSettled {
            bet_id,
            user: ctx.accounts.user_vault.owner,
            game,
            stake,
            payout,
            multiplier_bps,
        });
        Ok(())
    }

    /// Cosigner-signed PLAY-MONEY receipt (#26): records a bet outcome on
    /// chain WITHOUT moving any lamports. Deliberately a separate instruction
    /// + event from `settle_bet`, so a value-bearing settlement receipt can
    /// never be confused with a play-money record on an explorer.
    pub fn record_bet(
        ctx: Context<RecordBet>,
        bet_id: [u8; 16],
        game: GameType,
        stake: u64,
        payout: u64,
        multiplier_bps: u32,
    ) -> Result<()> {
        let house = &ctx.accounts.house;
        require!(!house.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            house.cosigner,
            VaultError::NotCosigner
        );
        emit!(BetRecorded {
            bet_id,
            user: ctx.accounts.user.key(),
            game,
            stake,
            payout,
            multiplier_bps,
        });
        Ok(())
    }

    /// Cosigner-signed $SCAD reward claim from the rewards treasury.
    /// A ClaimRecord PDA keyed by (user, kind, period) blocks double-claims.
    pub fn claim_reward(
        ctx: Context<ClaimReward>,
        kind: RewardKind,
        period: u64,
        amount: u64,
    ) -> Result<()> {
        let house = &ctx.accounts.house;
        require!(!house.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            house.cosigner,
            VaultError::NotCosigner
        );
        require!(amount > 0, VaultError::ZeroAmount);

        let record = &mut ctx.accounts.claim_record;
        record.user = ctx.accounts.user.key();
        record.kind = kind;
        record.period = period;
        record.amount = amount;

        let seeds: &[&[u8]] = &[b"house", &[house.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_ata.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: house.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        emit!(RewardClaimed {
            user: record.user,
            kind,
            period,
            amount,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.house.paused = paused;
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[account]
pub struct House {
    pub authority: Pubkey,
    pub cosigner: Pubkey,
    pub scad_mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
impl House {
    pub const SIZE: usize = 8 + 32 * 3 + 1 + 1 + 1;
}

#[account]
pub struct UserVault {
    pub owner: Pubkey,
    pub bump: u8,
}
impl UserVault {
    pub const SIZE: usize = 8 + 32 + 1;
}

#[account]
pub struct ClaimRecord {
    pub user: Pubkey,
    pub kind: RewardKind,
    pub period: u64,
    pub amount: u64,
}
impl ClaimRecord {
    pub const SIZE: usize = 8 + 32 + 1 + 8 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum GameType {
    Crash,
    Coinflip,
    Blackjack,
    Lottery,
    Jackpot,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RewardKind {
    WagerReward,
    Cashback,
    DailyCase,
    Airdrop,
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitHouse<'info> {
    #[account(
        init,
        payer = authority,
        space = House::SIZE,
        seeds = [b"house"],
        bump
    )]
    pub house: Account<'info, House>,
    /// CHECK: plain lamport vault PDA, no data.
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"house_vault"],
        bump,
        owner = crate::ID
    )]
    pub house_vault: UncheckedAccount<'info>,
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = UserVault::SIZE,
        seeds = [b"user_vault", user.key().as_ref()],
        bump
    )]
    pub user_vault: Account<'info, UserVault>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"user_vault", user.key().as_ref()],
        bump = user_vault.bump
    )]
    pub user_vault: Account<'info, UserVault>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleBet<'info> {
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, House>,
    /// CHECK: house lamport vault PDA.
    #[account(mut, seeds = [b"house_vault"], bump = house.vault_bump)]
    pub house_vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = cosigner,
        space = UserVault::SIZE,
        seeds = [b"user_vault", user.key().as_ref()],
        bump
    )]
    pub user_vault: Account<'info, UserVault>,
    /// CHECK: vault owner — seed + event field only.
    pub user: UncheckedAccount<'info>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordBet<'info> {
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, House>,
    /// CHECK: the player — event field only; no lamports move.
    pub user: UncheckedAccount<'info>,
    pub cosigner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(kind: RewardKind, period: u64)]
pub struct ClaimReward<'info> {
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, House>,
    #[account(
        init,
        payer = cosigner,
        space = ClaimRecord::SIZE,
        seeds = [b"claim", user.key().as_ref(), &[kind as u8], &period.to_le_bytes()],
        bump
    )]
    pub claim_record: Account<'info, ClaimRecord>,
    /// CHECK: recipient — only used as ATA owner + event field.
    pub user: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = scad_mint,
        associated_token::authority = house
    )]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = cosigner,
        associated_token::mint = scad_mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,
    #[account(address = house.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"house"], bump = house.bump, has_one = authority)]
    pub house: Account<'info, House>,
    pub authority: Signer<'info>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct Deposited {
    pub user: Pubkey,
    pub amount: u64,
    pub vault_balance: u64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub amount: u64,
    pub vault_balance: u64,
}

#[event]
pub struct BetSettled {
    pub bet_id: [u8; 16],
    pub user: Pubkey,
    pub game: GameType,
    pub stake: u64,
    pub payout: u64,
    pub multiplier_bps: u32,
}

#[event]
pub struct BetRecorded {
    pub bet_id: [u8; 16],
    pub user: Pubkey,
    pub game: GameType,
    pub stake: u64,
    pub payout: u64,
    pub multiplier_bps: u32,
}

#[event]
pub struct RewardClaimed {
    pub user: Pubkey,
    pub kind: RewardKind,
    pub period: u64,
    pub amount: u64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Signer is not the vault owner")]
    NotVaultOwner,
    #[msg("Signer is not the registered cosigner")]
    NotCosigner,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Program is paused")]
    Paused,
}
