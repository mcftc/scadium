//! Scadium shared on-chain RNG (`scadium_rng`).
//!
//! ONE program supplies provably-fair entropy to EVERY game (crash, dice, mines,
//! coinflip, wheel, …) — not just the lottery. Each round follows the same
//! commit → reveal → SlotHashes-fold flow the lottery already uses:
//!
//! - Before play, the cosigner COMMITS `sha256(serverSeed)` and PINS a future
//!   `target_slot` whose hash cannot exist yet — so the operator cannot know (or
//!   grind) the round entropy at commit time.
//! - The round also binds a `game_params_hash`: an opaque 32-byte digest of the
//!   round's dynamics (max-win / auto-cashout / max-multiplier caps), computed
//!   off-chain by `@scadium/fair::gameParamsHash`. Binding it means the outcome
//!   depends on the declared rules, and any change is detectable.
//! - At reveal the program asserts `sha256(seed) == commitment`, looks up the
//!   SlotHashes entry for the PINNED slot, and folds everything into a single
//!   `final_entropy`. Games derive their multiplier / win-lose / number from it.
//!
//! Canonical fold — byte-for-byte identical to `packages/fair/src/derive.ts`
//! (`rngEntropy`) and `apps/web/src/lib/fair-browser.ts`, golden-vector locked:
//!
//!   final_entropy = sha256(
//!     server_seed[64] || slot_hash[32] || client_seed[32] || u32le(nonce) || game_params_hash[32]
//!   )
//!
//! The chain layer is the same off-chain-first hybrid as the rest of Scadium:
//! until this program is deployed the API derives the same entropy from a
//! deterministic synthetic slot hash (pass-through mode), so play-money stays
//! reproducible and nothing here is required to play.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use solana_sha256_hasher::hash as sha256;

declare_id!("3cPWLMPmbu9z5dKmAxXBqMsW3Uo1JYV9SMM4UR68HQCm");

/// The SlotHashes sysvar account (anchor 1.0's prelude doesn't re-export its ID).
pub const SLOT_HASHES_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarS1otHashes111111111111111111111111111");

#[program]
pub mod scadium_rng {
    use super::*;

    /// One-time config: register the cosigner allowed to open/settle rounds.
    pub fn init_rng(ctx: Context<InitRng>, cosigner: Pubkey) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.payer.key();
        cfg.cosigner = cosigner;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Cosigner opens a round: publishes the seed commitment + bound game params,
    /// and PINS a future slot whose hash will seed the reveal.
    // The instruction args mirror the on-chain round commitment 1:1 (game_type,
    // round_id, seed commitment, client seed, params hash, nonce, target slot);
    // bundling them into a struct would diverge from the Anchor IDL / the TS
    // golden-lockstep bindings, so the arg count is intentional here.
    #[allow(clippy::too_many_arguments)]
    pub fn open_round(
        ctx: Context<OpenRound>,
        game_type: u8,
        round_id: u64,
        server_seed_hash: [u8; 32],
        client_seed: [u8; 32],
        game_params_hash: [u8; 32],
        nonce: u32,
        target_slot: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            ctx.accounts.config.cosigner,
            RngError::NotCosigner
        );
        // The pinned slot must be in the FUTURE — its hash cannot exist yet, so
        // the operator cannot know the round entropy at open time.
        require!(target_slot > Clock::get()?.slot, RngError::TargetSlotNotFuture);
        let round = &mut ctx.accounts.round;
        round.game_type = game_type;
        round.round_id = round_id;
        round.server_seed_hash = server_seed_hash;
        round.client_seed = client_seed;
        round.game_params_hash = game_params_hash;
        round.nonce = nonce;
        round.target_slot = target_slot;
        round.status = RoundStatus::Open;
        round.bump = ctx.bumps.round;
        emit!(RoundOpened {
            game_type,
            round_id,
            server_seed_hash,
            client_seed,
            game_params_hash,
            nonce,
            target_slot,
        });
        Ok(())
    }

    /// Cosigner reveals the seed; the program re-derives `final_entropy` ITSELF
    /// from the PINNED slot's hash so the cosigner cannot grind the outcome by
    /// choosing when to reveal.
    pub fn settle_round(
        ctx: Context<SettleRound>,
        game_type: u8,
        round_id: u64,
        server_seed: [u8; 64], // utf8 hex of the 32-byte seed (matches commit)
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.cosigner.key(),
            ctx.accounts.config.cosigner,
            RngError::NotCosigner
        );
        let round = &mut ctx.accounts.round;
        require!(round.round_id == round_id, RngError::WrongRound);
        require!(round.game_type == game_type, RngError::WrongRound);
        require!(round.status == RoundStatus::Open, RngError::RoundClosed);
        require!(
            sha256(&server_seed).to_bytes() == round.server_seed_hash,
            RngError::SeedMismatch
        );

        // Derive from the slot PINNED at open (NOT the newest entry). The
        // SlotHashes sysvar holds ~512 recent slots as (u64 slot, [u8;32] hash)
        // pairs after a u64 count; require an exact match for `target_slot`.
        let slot = round.target_slot;
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        let slot_hash = find_slot_hash(&data, slot).ok_or(RngError::TargetSlotNotAvailable)?;
        drop(data);

        let final_entropy = derive_entropy(
            &server_seed,
            &slot_hash,
            &round.client_seed,
            round.nonce,
            &round.game_params_hash,
        );

        round.revealed_seed = server_seed;
        round.slot = slot;
        round.slot_hash = slot_hash;
        round.final_entropy = final_entropy;
        round.status = RoundStatus::Settled;

        emit!(RoundSettled {
            game_type,
            round_id,
            server_seed_hash: round.server_seed_hash,
            revealed_seed: server_seed,
            slot,
            slot_hash,
            entropy: final_entropy,
        });
        Ok(())
    }
}

/// Find the 32-byte hash for `target_slot` in a SlotHashes sysvar buffer.
/// Layout: u64 LE count, then `count` × (u64 LE slot, [u8; 32] hash), newest
/// first. Returns `None` if the slot is not in the ~512-slot window or the
/// buffer is malformed — the caller maps that to `TargetSlotNotAvailable`.
fn find_slot_hash(data: &[u8], target_slot: u64) -> Option<[u8; 32]> {
    if data.len() < 8 {
        return None;
    }
    let count = u64::from_le_bytes(data[0..8].try_into().ok()?) as usize;
    for i in 0..count {
        let off = 8 + i * 40;
        if off + 40 > data.len() {
            break;
        }
        let slot = u64::from_le_bytes(data[off..off + 8].try_into().ok()?);
        if slot == target_slot {
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&data[off + 8..off + 40]);
            return Some(hash);
        }
    }
    None
}

/// Canonical entropy fold — MUST stay byte-for-byte identical to
/// `packages/fair/src/derive.ts::rngEntropy` and the browser verifier
/// (golden-vector locked in all three test suites):
///
///   final_entropy = sha256(
///     server_seed[64] || slot_hash[32] || client_seed[32] || u32le(nonce) || game_params_hash[32]
///   )
fn derive_entropy(
    server_seed: &[u8; 64],
    slot_hash: &[u8; 32],
    client_seed: &[u8; 32],
    nonce: u32,
    game_params_hash: &[u8; 32],
) -> [u8; 32] {
    let mut buf = [0u8; 64 + 32 + 32 + 4 + 32];
    buf[0..64].copy_from_slice(server_seed);
    buf[64..96].copy_from_slice(slot_hash);
    buf[96..128].copy_from_slice(client_seed);
    buf[128..132].copy_from_slice(&nonce.to_le_bytes());
    buf[132..164].copy_from_slice(game_params_hash);
    sha256(&buf).to_bytes()
}

// ---------------------------------------------------------------- state

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoundStatus {
    Open,
    Settled,
}

#[account]
pub struct RngConfig {
    pub authority: Pubkey,
    pub cosigner: Pubkey,
    pub bump: u8,
}
impl RngConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 1;
}

#[account]
pub struct Round {
    pub game_type: u8,
    pub round_id: u64,
    pub server_seed_hash: [u8; 32],
    pub client_seed: [u8; 32],
    pub game_params_hash: [u8; 32],
    pub nonce: u32,
    pub target_slot: u64,
    pub revealed_seed: [u8; 64],
    pub slot: u64,
    pub slot_hash: [u8; 32],
    pub final_entropy: [u8; 32],
    pub status: RoundStatus,
    pub bump: u8,
}
impl Round {
    pub const SIZE: usize =
        8 + 1 + 8 + 32 + 32 + 32 + 4 + 8 + 64 + 8 + 32 + 32 + 1 + 1;
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitRng<'info> {
    #[account(init, payer = payer, space = RngConfig::SIZE, seeds = [b"rng"], bump)]
    pub config: Account<'info, RngConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_type: u8, round_id: u64)]
pub struct OpenRound<'info> {
    #[account(seeds = [b"rng"], bump = config.bump)]
    pub config: Account<'info, RngConfig>,
    #[account(
        init,
        payer = cosigner,
        space = Round::SIZE,
        seeds = [b"round".as_ref(), &[game_type], &round_id.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub cosigner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_type: u8, round_id: u64)]
pub struct SettleRound<'info> {
    #[account(seeds = [b"rng"], bump = config.bump)]
    pub config: Account<'info, RngConfig>,
    #[account(
        mut,
        seeds = [b"round".as_ref(), &[game_type], &round_id.to_le_bytes()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    pub cosigner: Signer<'info>,
    /// CHECK: address-asserted SlotHashes sysvar; raw bytes parsed manually
    /// (the full sysvar is too large for Anchor's typed deserialization).
    #[account(address = SLOT_HASHES_SYSVAR_ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct RoundOpened {
    pub game_type: u8,
    pub round_id: u64,
    pub server_seed_hash: [u8; 32],
    pub client_seed: [u8; 32],
    pub game_params_hash: [u8; 32],
    pub nonce: u32,
    pub target_slot: u64,
}

#[event]
pub struct RoundSettled {
    pub game_type: u8,
    pub round_id: u64,
    pub server_seed_hash: [u8; 32],
    pub revealed_seed: [u8; 64],
    pub slot: u64,
    pub slot_hash: [u8; 32],
    pub entropy: [u8; 32],
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum RngError {
    #[msg("Signer is not the registered cosigner")]
    NotCosigner,
    #[msg("Round id / game type mismatch")]
    WrongRound,
    #[msg("Round is not open")]
    RoundClosed,
    #[msg("Revealed seed does not match the commitment")]
    SeedMismatch,
    #[msg("Pinned target slot must be in the future")]
    TargetSlotNotFuture,
    #[msg("SlotHashes entry for the pinned slot is unavailable")]
    TargetSlotNotAvailable,
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn decode_hex32(s: &str) -> [u8; 32] {
        assert_eq!(s.len(), 64, "hash must be 64 hex chars");
        core::array::from_fn(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap())
    }

    /// GOLDEN VECTOR — identical inputs/outputs asserted in
    /// `packages/fair/src/derive.test.ts`. Never change one without the other.
    #[test]
    fn entropy_golden_lockstep() {
        let server_seed: [u8; 64] = "deadbeef".repeat(8).as_bytes().try_into().unwrap();
        let mut client_seed = [0u8; 32];
        client_seed[..16].copy_from_slice(b"cafebabe12345678");
        let slot_hash: [u8; 32] = core::array::from_fn(|i| i as u8);

        // Empty game params → game_params_hash = sha256("").
        let empty_params_hash = decode_hex32(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        let entropy = derive_entropy(&server_seed, &slot_hash, &client_seed, 0, &empty_params_hash);
        assert_eq!(
            hex(&entropy),
            "bc0aa9d26d2af6910346ef4fa28f912f7511e427b840e3357f795f78b9c89721"
        );

        // Bound params: gameParamsHash({maxMultiplier:1000, autoCashout:2}).
        let params_hash = decode_hex32(
            "fa16087c3ed82f68b443d28bee9d51a7c16b7a299045eaf60684c2800b0ef324",
        );
        let entropy_p = derive_entropy(&server_seed, &slot_hash, &client_seed, 0, &params_hash);
        assert_eq!(
            hex(&entropy_p),
            "2f998e3725b5e68e212d14eda33e0f75d0ce14d06e7c61d3b78e80826230c440"
        );
    }

    #[test]
    fn find_slot_hash_picks_the_pinned_slot() {
        // Build a SlotHashes-shaped buffer: count, then (slot, hash) pairs.
        let mut buf = Vec::new();
        buf.extend_from_slice(&3u64.to_le_bytes());
        for slot in [300u64, 299, 298] {
            buf.extend_from_slice(&slot.to_le_bytes());
            let h: [u8; 32] = core::array::from_fn(|i| (slot as u8).wrapping_add(i as u8));
            buf.extend_from_slice(&h);
        }
        let got = find_slot_hash(&buf, 299).expect("slot 299 present");
        let expected: [u8; 32] = core::array::from_fn(|i| (299u64 as u8).wrapping_add(i as u8));
        assert_eq!(got, expected);
        assert!(find_slot_hash(&buf, 1234).is_none(), "absent slot → None");
    }
}
