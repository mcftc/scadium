-- SCAD Vault: per-user principal aggregate for the `scad_vault` ledger currency
-- (running total of the user's VaultPosition principals). Mirrors scadiumStaked.
ALTER TABLE "User" ADD COLUMN "scadiumVault" BIGINT NOT NULL DEFAULT 0;
