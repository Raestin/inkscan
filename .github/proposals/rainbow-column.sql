-- PROPOSAL ONLY. Not approved for production execution.
-- Separate approval, current owner backup/reconciliation and reviewed client rollout required.
-- This guard makes the file deliberately non-executable as a migration.
BEGIN;
DO $$ BEGIN RAISE EXCEPTION 'Proposal only: production rainbow-column migration is not approved'; END $$;
-- The preceding unconditional error aborts THIS transaction. Even a SQL runner
-- that continues after errors cannot execute the DDL below before the ROLLBACK.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.collection
  ADD COLUMN rainbow_foil integer NOT NULL DEFAULT 0
  CONSTRAINT collection_rainbow_foil_nonnegative CHECK (rainbow_foil >= 0);
-- Existing q/f values, primary key, timestamp trigger, ownership, grants and RLS stay unchanged.
-- Read back the column/constraint and compare all pre-existing user_id/card_id/q/f/updated_at
-- to the approved pre-migration snapshot before COMMIT in the eventual reviewed rollout.
ROLLBACK; -- Candidate rollout would commit only after reviewed preservation assertions.

-- Rollback is NOT an automatic DROP COLUMN. Once any rainbow quantity exists, preserve it.
-- An older client may remain q/f-only while the additive column stays in the database.
-- Only remove the new column after separately authorized export/reconciliation proves no loss.
