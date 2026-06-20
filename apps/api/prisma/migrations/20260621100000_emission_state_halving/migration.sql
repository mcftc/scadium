-- Persistent singleton counter of cumulative $SCAD emitted by proof-of-wager.
-- Drives the halving schedule (SCAD.EMISSION_PHASES) and the hard P2E pool cap
-- (SCAD.P2E_POOL_BASE). `accrue()` reads + atomically upserts this in the same
-- tx as the $SCAD credit. Seed the singleton row at zero so the first accrue
-- finds it (the service upserts defensively too).

-- CreateTable
CREATE TABLE "EmissionState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "totalEmittedScad" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissionState_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row at zero emitted.
INSERT INTO "EmissionState" ("id", "totalEmittedScad", "updatedAt")
VALUES ('singleton', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
