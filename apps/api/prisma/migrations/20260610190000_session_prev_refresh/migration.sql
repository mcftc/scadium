-- Phase K (#35): refresh-token reuse detection. Store the hash of the
-- previous (rotated-out) refresh token; replaying it revokes the session.

ALTER TABLE "Session" ADD COLUMN "prevRefreshToken" TEXT;
