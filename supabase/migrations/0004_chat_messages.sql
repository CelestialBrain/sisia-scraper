-- Chat Message Logging (Enhanced for AI Analysis)
-- Stores conversation history with full-text search and structured metadata

CREATE TABLE IF NOT EXISTS chat_message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  
  -- Structured data for analysis
  tool_calls JSONB,  -- Array of {name, args, result}
  intent TEXT,  -- Detected user intent (e.g., "schedule_query", "grade_check")
  entities JSONB DEFAULT '[]',  -- Extracted entities: [{type: "course", value: "LLAW 113"}]
  
  -- Performance metrics
  latency_ms INTEGER,  -- Response time in milliseconds
  tokens_used INTEGER,  -- Tokens consumed
  model TEXT DEFAULT 'gemini-2.0-flash',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Full-text search vector (auto-updated)
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(content, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(intent, '')), 'B')
  ) STORED
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_message(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_message(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_intent ON chat_message(intent) WHERE intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_search ON chat_message USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_chat_entities ON chat_message USING GIN(entities);

-- Row Level Security
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;

-- Users can only access their own messages
CREATE POLICY "users_own_messages" ON chat_message
  FOR ALL USING (auth.uid() = user_id);

-- Allow anonymous sessions (null user_id) to be created
CREATE POLICY "allow_anonymous_insert" ON chat_message
  FOR INSERT WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- View for analytics (aggregate stats)
CREATE OR REPLACE VIEW chat_analytics AS
SELECT 
  DATE(created_at) as date,
  intent,
  COUNT(*) as message_count,
  AVG(latency_ms)::INTEGER as avg_latency_ms,
  SUM(tokens_used) as total_tokens
FROM chat_message
WHERE role = 'assistant'
GROUP BY DATE(created_at), intent
ORDER BY date DESC, message_count DESC;

COMMENT ON TABLE chat_message IS 'Stores chat history with full-text search and AI-analyzable structure';
COMMENT ON COLUMN chat_message.intent IS 'Auto-detected user intent for categorization';
COMMENT ON COLUMN chat_message.entities IS 'Extracted entities like courses, instructors, sections';
COMMENT ON COLUMN chat_message.search_vector IS 'Full-text search index for content and intent';
