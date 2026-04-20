-- Add idempotency_key to transactions
-- Allows callers to pass a client-generated UUID that prevents duplicate inserts.
-- NULL keys are allowed (existing rows + AI-created transactions) — PostgreSQL UNIQUE
-- treats NULLs as distinct, so multiple NULL values never conflict.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_idempotency_key_unique UNIQUE (idempotency_key);
