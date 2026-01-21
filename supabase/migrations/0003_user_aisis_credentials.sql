-- Migration: AISIS Credentials Storage
-- Uses Supabase Auth for user management
-- Stores encrypted AISIS credentials per user

-- Enable pgcrypto for encryption functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- AISIS credentials table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.aisis_credential (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  iv TEXT NOT NULL,  -- Initialization vector for AES decryption
  auth_tag TEXT NOT NULL,  -- GCM authentication tag
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_aisis_credential_user_id ON public.aisis_credential(user_id);

-- User preferences table
CREATE TABLE IF NOT EXISTS public.user_preference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  default_term TEXT DEFAULT '2025-2',
  language TEXT DEFAULT 'en',
  theme TEXT DEFAULT 'dark',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Personal data cache (scraped from AISIS, cached for performance)
CREATE TABLE IF NOT EXISTS public.user_schedule_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  schedule_data JSONB NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE(user_id, term)
);

CREATE TABLE IF NOT EXISTS public.user_ips_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ips_data JSONB NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

CREATE TABLE IF NOT EXISTS public.user_grades_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  grades_data JSONB NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, term)
);

-- RLS Policies (Row Level Security)
ALTER TABLE public.aisis_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_schedule_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ips_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_grades_cache ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users can view own credentials" ON public.aisis_credential
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own credentials" ON public.aisis_credential
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own credentials" ON public.aisis_credential
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own credentials" ON public.aisis_credential
  FOR DELETE USING (auth.uid() = user_id);

-- Same for preferences
CREATE POLICY "Users can manage own preferences" ON public.user_preference
  FOR ALL USING (auth.uid() = user_id);

-- Same for cache tables
CREATE POLICY "Users can manage own schedule cache" ON public.user_schedule_cache
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own IPS cache" ON public.user_ips_cache
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own grades cache" ON public.user_grades_cache
  FOR ALL USING (auth.uid() = user_id);

-- Comment explaining security
COMMENT ON TABLE public.aisis_credential IS 'Stores encrypted AISIS credentials. Password is AES-256-GCM encrypted client-side before storage.';
