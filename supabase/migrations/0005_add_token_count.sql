-- Add token_count column to chat_message table
-- The code uses token_count but the original schema had tokens_used

ALTER TABLE chat_message
ADD COLUMN IF NOT EXISTS token_count INTEGER;

-- Create index for token analytics
CREATE INDEX IF NOT EXISTS idx_chat_token_count ON chat_message (token_count)
WHERE
    token_count IS NOT NULL;

-- Update chat_analytics view to include token_count
CREATE OR REPLACE VIEW chat_analytics AS
SELECT 
  DATE(created_at) as date,
  intent,
  COUNT(*) as message_count,
  AVG(latency_ms)::INTEGER as avg_latency_ms,
  SUM(COALESCE(token_count, tokens_used)) as total_tokens
FROM chat_message
WHERE role = 'assistant'
GROUP BY DATE(created_at), intent
ORDER BY date DESC, message_count DESC;

COMMENT ON COLUMN chat_message.token_count IS 'Token count for this message';