//! scadium_swap — minimal constant-product (x·y=k) SCAD/SOL pool.
//!
//! One pool, user-signed operations (matching solpump's "processed using
//! your primary wallet"): swaps and liquidity changes are real wallet txs.
//! SOL side lives in a lamport-vault PDA; SCAD side in the pool's ATA;
//! LP shares are a plain SPL mint whose authority is the pool PDA.
//!
//! All amount math runs in u128 and floors toward the pool, so `k` can
//! never decrease via rounding.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer as SplTransfer};

declare_id!("9Fog7cFRQiPfszYu1ioFdqQDwmmTd6SZpkyb8hyo13dU");

const BPS: u128 = 10_000;

/// Dead shares permanently locked on the FIRST add_liquidity (#31) — minted to
/// the pool's own LP ATA, which no instruction can ever move. Without this, a
/// 1-unit first deposit + direct donation inflates the LP share price so later
/// depositors round to zero shares (the classic Uniswap-V2 inflation attack).
pub const MINIMUM_LIQUIDITY: u64 = 1_000;

/// First-deposit LP split: total sqrt(scad·sol) minus the locked dead shares.
/// Errors when the deposit is too small to cover the lock. Checked end-to-end
/// (#31): with u64 inputs the u128 intermediates are provably bounded, but the
/// arithmetic stays `checked_*` so a future formula change can't silently wrap.
fn first_lp_split(scad_amount: u64, sol_amount: u64) -> Result<(u64, u64)> {
    let product = (scad_amount as u128)
        .checked_mul(sol_amount as u128)
        .ok_or(SwapError::MathOverflow)?;
    let total = u64::try_from(integer_sqrt(product)).map_err(|_| SwapError::MathOverflow)?;
    require!(total > MINIMUM_LIQUIDITY, SwapError::InsufficientInitialLiquidity);
    Ok((MINIMUM_LIQUIDITY, total - MINIMUM_LIQUIDITY))
}

/// Constant-product output for a swap of `amount_in` against (r_in, r_out)
/// with `fee_bps` kept in the pool. Mirrored by apps/api/src/swap/swap-math.ts
/// (the buy-and-burn min_out) — keep in lockstep.
fn cpmm_out(amount_in: u64, r_in: u128, r_out: u128, fee_bps: u128) -> Result<u64> {
    let in_after_fee = (amount_in as u128)
        .checked_mul(BPS.checked_sub(fee_bps).ok_or(SwapError::MathOverflow)?)
        .ok_or(SwapError::MathOverflow)?
        / BPS;
    let numer = in_after_fee.checked_mul(r_out).ok_or(SwapError::MathOverflow)?;
    let denom = r_in.checked_add(in_after_fee).ok_or(SwapError::MathOverflow)?;
    u64::try_from(numer / denom).map_err(|_| SwapError::MathOverflow.into())
}

#[program]
pub mod scadium_swap {
    use super::*;

    pub fn init_pool(ctx: Context<InitPool>, fee_bps: u16) -> Result<()> {
        require!(fee_bps < 1_000, SwapError::FeeTooHigh); // < 10%
        let pool = &mut ctx.accounts.pool;
        pool.scad_mint = ctx.accounts.scad_mint.key();
        pool.lp_mint = ctx.accounts.lp_mint.key();
        pool.fee_bps = fee_bps;
        pool.bump = ctx.bumps.pool;
        pool.sol_vault_bump = ctx.bumps.sol_vault;
        Ok(())
    }

    /// Deposit both sides; receive LP. First add sets the price and mints
    /// sqrt(scad·sol); later adds must be proportional (the smaller ratio
    /// wins, excess of the other side is simply not pulled).
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        scad_amount: u64,
        sol_amount: u64,
        min_lp: u64,
    ) -> Result<()> {
        require!(scad_amount > 0 && sol_amount > 0, SwapError::ZeroAmount);
        let scad_res = ctx.accounts.pool_scad.amount as u128;
        let sol_res = vault_lamports(&ctx.accounts.sol_vault)? as u128;
        let lp_supply = ctx.accounts.lp_mint.supply as u128;

        let (scad_in, sol_in, lp_out, lp_locked) = if lp_supply == 0 {
            // First add: lock MINIMUM_LIQUIDITY dead shares (#31).
            let (locked, to_depositor) = first_lp_split(scad_amount, sol_amount)?;
            (scad_amount, sol_amount, to_depositor, locked)
        } else {
            // Proportional add: scale to whichever side is the limiting one.
            let lp_from_scad = (scad_amount as u128)
                .checked_mul(lp_supply)
                .ok_or(SwapError::MathOverflow)?
                / scad_res;
            let lp_from_sol = (sol_amount as u128)
                .checked_mul(lp_supply)
                .ok_or(SwapError::MathOverflow)?
                / sol_res;
            let lp = lp_from_scad.min(lp_from_sol);
            let scad_need = u64::try_from(
                lp.checked_mul(scad_res).ok_or(SwapError::MathOverflow)?.div_ceil(lp_supply),
            )
            .map_err(|_| SwapError::MathOverflow)?;
            let sol_need = u64::try_from(
                lp.checked_mul(sol_res).ok_or(SwapError::MathOverflow)?.div_ceil(lp_supply),
            )
            .map_err(|_| SwapError::MathOverflow)?;
            let lp = u64::try_from(lp).map_err(|_| SwapError::MathOverflow)?;
            (scad_need, sol_need, lp, 0u64)
        };
        require!(lp_out >= min_lp && lp_out > 0, SwapError::SlippageExceeded);

        // Pull SCAD from the user.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.user_scad.to_account_info(),
                    to: ctx.accounts.pool_scad.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            scad_in,
        )?;
        // Pull SOL from the user.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            sol_in,
        )?;
        // Mint LP to the user (pool PDA signs).
        let seeds: &[&[u8]] = &[b"pool", &[ctx.accounts.pool.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.user_lp.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[seeds],
            ),
            lp_out,
        )?;
        if lp_locked > 0 {
            // Dead shares to the pool's OWN LP ATA — no instruction ever moves
            // LP out of the pool authority, so they are locked forever.
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    MintTo {
                        mint: ctx.accounts.lp_mint.to_account_info(),
                        to: ctx.accounts.pool_lp.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[seeds],
                ),
                lp_locked,
            )?;
        }

        emit!(LiquidityChanged {
            user: ctx.accounts.user.key(),
            added: true,
            scad: scad_in,
            sol: sol_in,
            lp: lp_out,
        });
        Ok(())
    }

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_amount: u64,
        min_scad: u64,
        min_sol: u64,
    ) -> Result<()> {
        require!(lp_amount > 0, SwapError::ZeroAmount);
        let scad_res = ctx.accounts.pool_scad.amount as u128;
        let sol_res = vault_lamports(&ctx.accounts.sol_vault)? as u128;
        let lp_supply = ctx.accounts.lp_mint.supply as u128;
        require!(lp_supply > 0, SwapError::EmptyPool);

        let scad_out = u64::try_from(
            (lp_amount as u128).checked_mul(scad_res).ok_or(SwapError::MathOverflow)? / lp_supply,
        )
        .map_err(|_| SwapError::MathOverflow)?;
        let sol_out = u64::try_from(
            (lp_amount as u128).checked_mul(sol_res).ok_or(SwapError::MathOverflow)? / lp_supply,
        )
        .map_err(|_| SwapError::MathOverflow)?;
        require!(
            scad_out >= min_scad && sol_out >= min_sol,
            SwapError::SlippageExceeded
        );

        // Burn the user's LP.
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    from: ctx.accounts.user_lp.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            lp_amount,
        )?;
        // Pay out both sides (pool PDA signs SCAD; lamports move directly).
        let seeds: &[&[u8]] = &[b"pool", &[ctx.accounts.pool.bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.pool_scad.to_account_info(),
                    to: ctx.accounts.user_scad.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[seeds],
            ),
            scad_out,
        )?;
        ctx.accounts.sol_vault.sub_lamports(sol_out)?;
        ctx.accounts.user.add_lamports(sol_out)?;

        emit!(LiquidityChanged {
            user: ctx.accounts.user.key(),
            added: false,
            scad: scad_out,
            sol: sol_out,
            lp: lp_amount,
        });
        Ok(())
    }

    /// Swap with a constant-product curve and `fee_bps` taken from the
    /// input side (fee stays in the pool → accrues to LPs).
    pub fn swap(
        ctx: Context<Swap>,
        sol_to_scad: bool,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        require!(amount_in > 0, SwapError::ZeroAmount);
        let scad_res = ctx.accounts.pool_scad.amount as u128;
        let sol_res = vault_lamports(&ctx.accounts.sol_vault)? as u128;
        require!(scad_res > 0 && sol_res > 0, SwapError::EmptyPool);

        let fee_bps = ctx.accounts.pool.fee_bps as u128;
        let (r_in, r_out) = if sol_to_scad {
            (sol_res, scad_res)
        } else {
            (scad_res, sol_res)
        };
        let amount_out = cpmm_out(amount_in, r_in, r_out, fee_bps)?;
        require!(amount_out >= min_amount_out && amount_out > 0, SwapError::SlippageExceeded);

        let seeds: &[&[u8]] = &[b"pool", &[ctx.accounts.pool.bump]];
        if sol_to_scad {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.user.to_account_info(),
                        to: ctx.accounts.sol_vault.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    SplTransfer {
                        from: ctx.accounts.pool_scad.to_account_info(),
                        to: ctx.accounts.user_scad.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[seeds],
                ),
                amount_out,
            )?;
        } else {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    SplTransfer {
                        from: ctx.accounts.user_scad.to_account_info(),
                        to: ctx.accounts.pool_scad.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            ctx.accounts.sol_vault.sub_lamports(amount_out)?;
            ctx.accounts.user.add_lamports(amount_out)?;
        }

        emit!(Swapped {
            user: ctx.accounts.user.key(),
            sol_to_scad,
            amount_in,
            amount_out,
        });
        Ok(())
    }
}

fn vault_lamports(vault: &UncheckedAccount) -> Result<u64> {
    // The vault is a 0-space PDA: every lamport above absolute zero is
    // reserve. (Rent floor for 0 bytes is ~0.00089 SOL — we treat the full
    // balance as reserve and never withdraw below what swaps allow.)
    Ok(vault.lamports())
}

fn integer_sqrt(v: u128) -> u128 {
    if v < 2 {
        return v;
    }
    let mut x = v;
    let mut y = x.div_ceil(2);
    while y < x {
        x = y;
        y = (x + v / x) / 2;
    }
    x
}

// ---------------------------------------------------------------- state

#[account]
pub struct Pool {
    pub scad_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
    pub sol_vault_bump: u8,
}
impl Pool {
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 1 + 1;
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(init, payer = payer, space = Pool::SIZE, seeds = [b"pool"], bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: lamport vault PDA, no data.
    #[account(init, payer = payer, space = 0, seeds = [b"sol_vault"], bump, owner = crate::ID)]
    pub sol_vault: UncheckedAccount<'info>,
    pub scad_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = pool,
        seeds = [b"lp_mint"],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = scad_mint,
        associated_token::authority = pool
    )]
    pub pool_scad: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    /// CHECK: lamport vault PDA.
    #[account(mut, seeds = [b"sol_vault"], bump = pool.sol_vault_bump)]
    pub sol_vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = pool)]
    pub pool_scad: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"lp_mint"], bump)]
    pub lp_mint: Box<Account<'info, Mint>>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = user)]
    pub user_scad: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lp_mint,
        associated_token::authority = user
    )]
    pub user_lp: Box<Account<'info, TokenAccount>>,
    /// The pool's own LP ATA — holds the permanently locked MINIMUM_LIQUIDITY
    /// dead shares from the first add (#31). No instruction transfers from it.
    /// Boxed: the extra init_if_needed ATA pushed the frame past the 4KB SBF
    /// stack limit (access violation) — heap-allocating the accounts fixes it.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = lp_mint,
        associated_token::authority = pool
    )]
    pub pool_lp: Box<Account<'info, TokenAccount>>,
    #[account(address = pool.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: lamport vault PDA.
    #[account(mut, seeds = [b"sol_vault"], bump = pool.sol_vault_bump)]
    pub sol_vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = pool)]
    pub pool_scad: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"lp_mint"], bump)]
    pub lp_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = user)]
    pub user_scad: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = lp_mint, associated_token::authority = user)]
    pub user_lp: Account<'info, TokenAccount>,
    #[account(address = pool.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: lamport vault PDA.
    #[account(mut, seeds = [b"sol_vault"], bump = pool.sol_vault_bump)]
    pub sol_vault: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = scad_mint, associated_token::authority = pool)]
    pub pool_scad: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = scad_mint,
        associated_token::authority = user
    )]
    pub user_scad: Account<'info, TokenAccount>,
    #[account(address = pool.scad_mint)]
    pub scad_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct Swapped {
    pub user: Pubkey,
    pub sol_to_scad: bool,
    pub amount_in: u64,
    pub amount_out: u64,
}

#[event]
pub struct LiquidityChanged {
    pub user: Pubkey,
    pub added: bool,
    pub scad: u64,
    pub sol: u64,
    pub lp: u64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum SwapError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Pool has no liquidity")]
    EmptyPool,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("First deposit too small to cover the minimum-liquidity lock")]
    InsufficientInitialLiquidity,
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_lp_split_locks_minimum_liquidity_exactly() {
        // sqrt(4e18) = 2e9 → depositor gets 2e9 − 1000, lock is 1000.
        let (locked, to_depositor) = first_lp_split(2_000_000_000, 2_000_000_000).unwrap();
        assert_eq!(locked, MINIMUM_LIQUIDITY);
        assert_eq!(to_depositor, 2_000_000_000 - MINIMUM_LIQUIDITY);
    }

    #[test]
    fn first_lp_split_rejects_dust_first_deposits() {
        // sqrt(1_000_000) = 1000 == MINIMUM_LIQUIDITY → nothing left → reject.
        let err = first_lp_split(1_000, 1_000).unwrap_err();
        assert_eq!(err, SwapError::InsufficientInitialLiquidity.into());
        // 1-unit inflation-attack seed also rejected.
        assert!(first_lp_split(1, 1).is_err());
    }

    #[test]
    fn cpmm_out_matches_constant_product_with_fee() {
        // 1 SOL into (100 SOL, 1_000_000 SCAD) at 30 bps:
        // in_after_fee = 0.997 SOL → out = 0.997e9·1e15/(100e9+0.997e9)
        let out = cpmm_out(1_000_000_000, 100_000_000_000, 1_000_000_000_000_000, 30).unwrap();
        let in_after_fee: u128 = 1_000_000_000u128 * 9_970 / 10_000;
        let expected = in_after_fee * 1_000_000_000_000_000u128
            / (100_000_000_000u128 + in_after_fee);
        assert_eq!(out as u128, expected);
        assert!(out > 0);
    }

    #[test]
    fn cpmm_out_is_checked_end_to_end() {
        // Extreme-but-valid u64 inputs stay in range (bounded by construction);
        // the checked_* path returns a value, never wraps.
        let out = cpmm_out(u64::MAX, u64::MAX as u128, u64::MAX as u128, 0).unwrap();
        assert!(out <= u64::MAX / 2 + 1);
    }
}
