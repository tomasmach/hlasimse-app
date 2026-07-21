-- Add unique constraint for upsert to work correctly
-- This allows one token per user per device (identified by token string)

ALTER TABLE push_tokens
ADD CONSTRAINT push_tokens_user_token_unique UNIQUE (user_id, token);

-- Add index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
