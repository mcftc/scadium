-- AlterTable: SCAD Engine auto-stake preference (honours ENGINE.AUTO_STAKE_DEFAULT = true).
-- When enabled, earned $SCAD is swept into the locked staked balance on the next
-- staking touch once it clears ENGINE.MIN_STAKE_SCAD_BASE.
ALTER TABLE "User" ADD COLUMN     "autoStakeEnabled" BOOLEAN NOT NULL DEFAULT true;
