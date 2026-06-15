-- CreateTable
CREATE TABLE "GeoCheck" (
    "id" UUID NOT NULL,
    "ipHash" TEXT NOT NULL,
    "country" TEXT,
    "vpnScore" DOUBLE PRECISION,
    "allowed" BOOLEAN NOT NULL,
    "path" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeoCheck_createdAt_idx" ON "GeoCheck"("createdAt");
