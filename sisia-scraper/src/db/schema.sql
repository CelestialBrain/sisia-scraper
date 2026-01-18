-- SISIA Scraper - Professor Feedback Storage
-- Stores scraped data from Facebook "Ateneo Profs to Pick" group

-- Scrape sessions for audit trail
CREATE TABLE IF NOT EXISTS scrape_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    mode TEXT CHECK (
        mode IN (
            'semi-manual',
            'full-auto',
            'direct-url'
        )
    ) DEFAULT 'semi-manual',
    posts_captured INTEGER DEFAULT 0,
    comments_captured INTEGER DEFAULT 0,
    status TEXT CHECK (
        status IN (
            'running',
            'completed',
            'aborted'
        )
    ) DEFAULT 'running'
);

-- Raw captured HTML for reprocessing
CREATE TABLE IF NOT EXISTS raw_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES scrape_sessions (id),
    url TEXT NOT NULL,
    html_content TEXT NOT NULL,
    search_term TEXT, -- The professor/term searched for
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed BOOLEAN DEFAULT FALSE
);

-- Extraction log for tracking DOM extraction runs
CREATE TABLE IF NOT EXISTS extraction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES scrape_sessions (id),
    url TEXT NOT NULL,
    search_term TEXT,
    posts_extracted INTEGER DEFAULT 0,
    comments_extracted INTEGER DEFAULT 0,
    feedback_saved INTEGER DEFAULT 0,
    extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Parsed posts from the group
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capture_id INTEGER REFERENCES raw_captures (id),
    fb_post_id TEXT UNIQUE, -- Facebook's post ID if extractable
    post_url TEXT,
    author_type TEXT CHECK (
        author_type IN ('anonymous', 'named')
    ) DEFAULT 'anonymous',
    content TEXT NOT NULL,
    post_date TEXT, -- Raw date string from FB
    normalized_date DATETIME, -- Parsed date
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Professor feedback (anonymized comments)
CREATE TABLE IF NOT EXISTS professor_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER REFERENCES posts (id),
    instructor_id INTEGER, -- Links to sisia-chat's instructors table
    instructor_name_scraped TEXT NOT NULL, -- Original name as found in content
    instructor_name_matched TEXT, -- Normalized matched name
    match_confidence REAL, -- 0.0 to 1.0 match score
    feedback_text TEXT NOT NULL, -- The actual feedback (post or comment content)
    feedback_type TEXT CHECK (
        feedback_type IN ('post', 'comment')
    ) DEFAULT 'comment',
    sentiment TEXT CHECK (
        sentiment IN (
            'positive',
            'negative',
            'neutral',
            'mixed'
        )
    ),
    reactions INTEGER DEFAULT 0, -- Number of reactions on the comment
    reaction_types TEXT, -- JSON array of reaction types (like, love, haha, wow, sad, angry)
    post_reactions INTEGER DEFAULT 0, -- Number of reactions on the main post
    post_reaction_types TEXT, -- JSON array of reaction types on the main post
    source_url TEXT, -- Direct URL to the post/comment
    is_reply BOOLEAN DEFAULT FALSE, -- Whether this is a reply to another comment
    comment_hash TEXT UNIQUE, -- Hash for deduplication
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Professors to search for (imported from sisia-chat)
CREATE TABLE IF NOT EXISTS target_professors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_id INTEGER NOT NULL, -- ID from sisia-chat's instructors table
    name TEXT NOT NULL, -- Full name
    name_normalized TEXT NOT NULL, -- Lowercase, simplified for matching
    search_terms TEXT, -- JSON array of search variations
    priority INTEGER DEFAULT 0, -- Higher = search first
    last_searched_at DATETIME,
    posts_found INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_feedback_instructor ON professor_feedback (instructor_id);

CREATE INDEX IF NOT EXISTS idx_feedback_instructor_name ON professor_feedback (instructor_name_matched);

CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (normalized_date);

CREATE INDEX IF NOT EXISTS idx_target_name ON target_professors (name_normalized);

CREATE INDEX IF NOT EXISTS idx_raw_processed ON raw_captures (processed);