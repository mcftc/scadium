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

// ---- SCAD Vault (term staking) constants — mirror @scadium/shared `VAULT`. ----
/// Share-price fixed-point scalar (1e18). Mirrors `VAULT.RAY`.
pub const RAY: u128 = 1_000_000_000_000_000_000;
/// Shares permanently locked on a pool's first deposit (first-depositor index
/// inflation guard, à la Uniswap MINIMUM_LIQUIDITY).
pub const MINIMUM_LIQUIDITY: u128 = 1_000;
/// Early-exit penalty in bps of withdrawn assets. Mirrors `VAULT.EARLY_EXIT_PENALTY_BPS`.
pub const EARLY_EXIT_PENALTY_BPS: u64 = 1_000;
const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod scadium_vault {
    use super::*;

    pub fn init_house(ctx: Context<InitHouse>, cosigner: Pubkey) -> Result<()> {
        let house = &mut ctx.accounts.house;
        house.authority = ctx.accounts.authority.key();
        house.cosigner = cosigner;
        house.scad_mint = ctx.accounts.scad_mint.key();
        // SCAD Engine: USDS is the USD-pegged dividend mint paid to stakers.
        house.usds_mint = ctx.accounts.usds_mint.key();
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

    /// Cosigner-signed: pay a staker's USDS dividend for a distribution round.
    /// Mirrors `claim_reward` but moves the USDS mint instead of $SCAD. The
    /// ClaimRecord PDA seed includes `RewardKind::Dividend` + `period`, so a
    /// given (user, round) is paid at most once on chain — the same double-pay
    /// guard the off-chain DistributionClaim @@unique enforces.
    pub fn claim_dividend(
        ctx: Context<ClaimDividend>,
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
        record.kind = RewardKind::Dividend;
        record.period = period;
        record.amount = amount;

        let seeds: &[&[u8]] = &[b"house", &[house.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.usds_treasury_ata.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: house.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        emit!(RewardClaimed {
            user: record.user,
            kind: RewardKind::Dividend,
            period,
            amount,
        });
        Ok(())
    }

    // ---------------------------------------------------------- SCAD Vault
    // Term-staking pools (the on-chain twin of the off-chain VaultPool). Share/
    // index accounting mirrors `@scadium/shared`: deposits mint shares at the
    // pool index; yield (`vault_accrue`) and early-exit penalties RAISE the
    // index, so holders appreciate pro-rata. Custody is real SPL $SCAD held in a
    // per-pool token account owned by the pool PDA.

    /// Authority-signed: create a term pool + its $SCAD vault token account.
    pub fn init_vault_pool(ctx: Context<InitVaultPool>, term_days: u32, weight_bps: u16) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.scad_mint = ctx.accounts.scad_mint.key();
        pool.term_days = term_days;
        pool.weight_bps = weight_bps;
        pool.total_assets = 0;
        pool.total_shares = 0;
        pool.index_ray = RAY;
        pool.bump = ctx.bumps.pool;
        emit!(VaultPoolInitialized {
            pool: pool.key(),
            term_days,
            weight_bps,
        });
        Ok(())
    }

    /// User-signed: lock $SCAD into a term pool, minting shares at the current
    /// index. First deposit locks MINIMUM_LIQUIDITY shares in the pool.
    pub fn vault_deposit(ctx: Context<VaultDeposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let index_ray = ctx.accounts.pool.index_ray;
        let first = ctx.accounts.pool.total_shares == 0;
        let shares = shares_for_deposit(amount, index_ray);
        require!(shares > 0, VaultError::ZeroAmount);

        let minted = if first {
            require!(shares > MINIMUM_LIQUIDITY, VaultError::InsufficientFunds);
            shares - MINIMUM_LIQUIDITY
        } else {
            shares
        };

        // user $SCAD → pool vault.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.user_ata.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let term_days = ctx.accounts.pool.term_days;
        let pool = &mut ctx.accounts.pool;
        pool.total_shares += shares; // first deposit also banks the locked minimum
        pool.total_assets += amount;

        let position = &mut ctx.accounts.position;
        if position.owner == Pubkey::default() {
            position.owner = ctx.accounts.user.key();
            position.pool = pool.key();
            position.bump = ctx.bumps.position;
        }
        require_keys_eq!(position.owner, ctx.accounts.user.key(), VaultError::NotVaultOwner);
        position.shares += minted;
        position.principal += amount;
        position.matures_at = Clock::get()?.unix_timestamp + (term_days as i64) * SECONDS_PER_DAY;

        emit!(VaultDeposited {
            pool: pool.key(),
            user: position.owner,
            amount,
            shares: minted,
            matures_at: position.matures_at,
        });
        Ok(())
    }

    /// User-signed: withdraw `shares` from the caller's position. Before maturity
    /// an EARLY_EXIT_PENALTY_BPS cut is kept in the pool (raising the index).
    pub fn vault_withdraw(ctx: Context<VaultWithdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroAmount);
        let shares = shares as u128;
        require_keys_eq!(
            ctx.accounts.position.owner,
            ctx.accounts.user.key(),
            VaultError::NotVaultOwner
        );
        require!(shares <= ctx.accounts.position.shares, VaultError::InsufficientFunds);

        let index_ray = ctx.accounts.pool.index_ray;
        let gross = assets_for_shares(shares, index_ray);
        let now = Clock::get()?.unix_timestamp;
        let penalty = if now < ctx.accounts.position.matures_at {
            early_exit_penalty(gross)
        } else {
            0
        };
        let net = gross - penalty;

        let pos_shares = ctx.accounts.position.shares;
        let pos_principal = ctx.accounts.position.principal;
        let principal_portion = if shares == pos_shares {
            pos_principal
        } else {
            ((pos_principal as u128) * shares / pos_shares) as u64
        };

        // Pool: remove shares + net assets; the penalty stays and lifts the index.
        let new_total_shares = ctx.accounts.pool.total_shares - shares;
        let scad_mint = ctx.accounts.pool.scad_mint;
        let term_le = ctx.accounts.pool.term_days.to_le_bytes();
        let pool_bump = ctx.accounts.pool.bump;
        {
            let pool = &mut ctx.accounts.pool;
            pool.index_ray = apply_accrual(pool.index_ray, new_total_shares, penalty);
            pool.total_shares = new_total_shares;
            pool.total_assets = pool.total_assets.saturating_sub(net);
        }
        {
            let position = &mut ctx.accounts.position;
            position.shares -= shares;
            position.principal -= principal_portion;
        }

        if net > 0 {
            let seeds: &[&[u8]] = &[b"vault_pool", scad_mint.as_ref(), &term_le, &[pool_bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    SplTransfer {
                        from: ctx.accounts.pool_vault.to_account_info(),
                        to: ctx.accounts.user_ata.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[seeds],
                ),
                net,
            )?;
        }

        emit!(VaultWithdrawn {
            pool: ctx.accounts.pool.key(),
            user: ctx.accounts.user.key(),
            shares,
            gross,
            penalty,
            net,
        });
        Ok(())
    }

    /// Cosigner-signed: add `amount` $SCAD yield to a pool, raising its index for
    /// all current stakers. Funds come from the house treasury ATA.
    pub fn vault_accrue(ctx: Context<VaultAccrue>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.house.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            ctx.accounts.house.cosigner,
            VaultError::NotCosigner
        );
        require!(amount > 0, VaultError::ZeroAmount);
        require!(ctx.accounts.pool.total_shares > 0, VaultError::InsufficientFunds);

        let house_bump = ctx.accounts.house.bump;
        let seeds: &[&[u8]] = &[b"house", &[house_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_ata.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                    authority: ctx.accounts.house.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        let pool = &mut ctx.accounts.pool;
        pool.index_ray = apply_accrual(pool.index_ray, pool.total_shares, amount);
        pool.total_assets += amount;
        emit!(VaultAccrued {
            pool: pool.key(),
            amount,
            index_ray: pool.index_ray,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.house.paused = paused;
        Ok(())
    }
}

// ---------------------------------------------------------------- vault math
// Pure share/index helpers — bit-for-bit the @scadium/shared formulas, in u128.

pub fn shares_for_deposit(assets: u64, index_ray: u128) -> u128 {
    if assets == 0 || index_ray == 0 {
        return 0;
    }
    (assets as u128) * RAY / index_ray
}

pub fn assets_for_shares(shares: u128, index_ray: u128) -> u64 {
    if shares == 0 || index_ray == 0 {
        return 0;
    }
    let a = shares * index_ray / RAY;
    if a > u64::MAX as u128 {
        u64::MAX
    } else {
        a as u64
    }
}

pub fn apply_accrual(index_ray: u128, total_shares: u128, yield_assets: u64) -> u128 {
    if total_shares == 0 || yield_assets == 0 {
        return index_ray;
    }
    index_ray + (yield_assets as u128) * RAY / total_shares
}

pub fn early_exit_penalty(assets: u64) -> u64 {
    ((assets as u128) * (EARLY_EXIT_PENALTY_BPS as u128) / 10_000) as u64
}

// ---------------------------------------------------------------- accounts

#[account]
pub struct House {
    pub authority: Pubkey,
    pub cosigner: Pubkey,
    pub scad_mint: Pubkey,
    pub usds_mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
impl House {
    pub const SIZE: usize = 8 + 32 * 4 + 1 + 1 + 1;
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

/// A SCAD Vault term pool — share/index accounting + a $SCAD vault token account
/// (the on-chain twin of the off-chain `VaultPool`).
#[account]
pub struct VaultPool {
    pub scad_mint: Pubkey,
    pub term_days: u32,
    pub weight_bps: u16,
    pub total_assets: u64,
    pub total_shares: u128,
    pub index_ray: u128,
    pub bump: u8,
}
impl VaultPool {
    pub const SIZE: usize = 8 + 32 + 4 + 2 + 8 + 16 + 16 + 1;
}

/// A user's stake in one term pool (aggregated; one position per pool).
#[account]
pub struct UserVaultPosition {
    pub owner: Pubkey,
    pub pool: Pubkey,
    pub shares: u128,
    pub principal: u64,
    pub matures_at: i64,
    pub bump: u8,
}
impl UserVaultPosition {
    pub const SIZE: usize = 8 + 32 + 32 + 16 + 8 + 8 + 1;
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
    // SCAD Engine staker dividend, paid in USDS (see claim_dividend).
    Dividend,
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
    /// SCAD Engine: the USD-pegged dividend mint stakers are paid in.
    pub usds_mint: Account<'info, Mint>,
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
#[instruction(period: u64)]
pub struct ClaimDividend<'info> {
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, House>,
    #[account(
        init,
        payer = cosigner,
        space = ClaimRecord::SIZE,
        seeds = [b"claim", user.key().as_ref(), &[RewardKind::Dividend as u8], &period.to_le_bytes()],
        bump
    )]
    pub claim_record: Account<'info, ClaimRecord>,
    /// CHECK: recipient — only used as ATA owner + event field.
    pub user: UncheckedAccount<'info>,
    #[account(
        mut,
        associated_token::mint = usds_mint,
        associated_token::authority = house
    )]
    pub usds_treasury_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = cosigner,
        associated_token::mint = usds_mint,
        associated_token::authority = user
    )]
    pub user_ata: Account<'info, TokenAccount>,
    #[account(address = house.usds_mint)]
    pub usds_mint: Account<'info, Mint>,
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

#[derive(Accounts)]
#[instruction(term_days: u32)]
pub struct InitVaultPool<'info> {
    #[account(seeds = [b"house"], bump = house.bump, has_one = authority)]
    pub house: Account<'info, House>,
    #[account(
        init,
        payer = authority,
        space = VaultPool::SIZE,
        seeds = [b"vault_pool", scad_mint.key().as_ref(), &term_days.to_le_bytes()],
        bump
    )]
    pub pool: Account<'info, VaultPool>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = scad_mint,
        associated_token::authority = pool
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(address = house.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VaultDeposit<'info> {
    #[account(
        mut,
        seeds = [b"vault_pool", pool.scad_mint.as_ref(), &pool.term_days.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, VaultPool>,
    #[account(
        init_if_needed,
        payer = user,
        space = UserVaultPosition::SIZE,
        seeds = [b"vault_pos", user.key().as_ref(), pool.key().as_ref()],
        bump
    )]
    pub position: Account<'info, UserVaultPosition>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = pool)]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = user)]
    pub user_ata: Account<'info, TokenAccount>,
    #[account(address = pool.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VaultWithdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault_pool", pool.scad_mint.as_ref(), &pool.term_days.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, VaultPool>,
    #[account(
        mut,
        seeds = [b"vault_pos", user.key().as_ref(), pool.key().as_ref()],
        bump = position.bump
    )]
    pub position: Account<'info, UserVaultPosition>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = pool)]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = user)]
    pub user_ata: Account<'info, TokenAccount>,
    #[account(address = pool.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct VaultAccrue<'info> {
    #[account(seeds = [b"house"], bump = house.bump)]
    pub house: Account<'info, House>,
    #[account(
        mut,
        seeds = [b"vault_pool", pool.scad_mint.as_ref(), &pool.term_days.to_le_bytes()],
        bump = pool.bump
    )]
    pub pool: Account<'info, VaultPool>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = house)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = pool)]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(address = house.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub token_program: Program<'info, Token>,
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

#[event]
pub struct VaultPoolInitialized {
    pub pool: Pubkey,
    pub term_days: u32,
    pub weight_bps: u16,
}

#[event]
pub struct VaultDeposited {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub shares: u128,
    pub matures_at: i64,
}

#[event]
pub struct VaultWithdrawn {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub shares: u128,
    pub gross: u64,
    pub penalty: u64,
    pub net: u64,
}

#[event]
pub struct VaultAccrued {
    pub pool: Pubkey,
    pub amount: u64,
    pub index_ray: u128,
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

// ---------------------------------------------------------------- tests
#[cfg(test)]
mod vault_math_tests {
    use super::*;

    #[test]
    fn mints_one_to_one_at_genesis() {
        let d: u64 = 5_000_000_000;
        assert_eq!(shares_for_deposit(d, RAY), d as u128);
        assert_eq!(assets_for_shares(d as u128, RAY), d);
    }

    #[test]
    fn round_trip_never_returns_more_than_principal() {
        let index = RAY * 3;
        for d in [1_000_000_000u64, 7_777_777_777, 123_456_789_012] {
            let shares = shares_for_deposit(d, index);
            let back = assets_for_shares(shares, index);
            assert!(back <= d);
            assert!(d - back <= 1);
        }
    }

    #[test]
    fn accrual_raises_index_and_conserves_value() {
        let d: u64 = 100_000_000_000;
        let shares = shares_for_deposit(d, RAY);
        let yield_assets: u64 = 10_000_000_000;
        let i2 = apply_accrual(RAY, shares, yield_assets);
        assert!(i2 > RAY);
        let value = assets_for_shares(shares, i2);
        assert!(value >= d + yield_assets - 1 && value <= d + yield_assets);
    }

    #[test]
    fn accrual_is_noop_on_empty_or_zero() {
        assert_eq!(apply_accrual(RAY, 0, 5), RAY);
        assert_eq!(apply_accrual(RAY, 100, 0), RAY);
    }

    #[test]
    fn early_exit_penalty_is_ten_percent() {
        let a: u64 = 100_000_000_000;
        assert_eq!(early_exit_penalty(a), a / 10);
        assert_eq!(early_exit_penalty(0), 0);
    }

    #[test]
    fn zero_inputs_yield_zero() {
        assert_eq!(shares_for_deposit(0, RAY), 0);
        assert_eq!(shares_for_deposit(100, 0), 0);
        assert_eq!(assets_for_shares(0, RAY), 0);
    }
}
