-- Enable RLS on push_tokens
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own push tokens
CREATE POLICY "Users can insert own tokens"
ON push_tokens FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own tokens"
ON push_tokens FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens"
ON push_tokens FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
ON push_tokens FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role can read all tokens (for Edge Function)
-- Note: Service role bypasses RLS by default
