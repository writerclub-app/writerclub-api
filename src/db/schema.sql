-- Profiles (espelho leve do auth provider)
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  auth_id     TEXT NOT NULL UNIQUE,
  username    TEXT NOT NULL UNIQUE,
  display_name TEXT,
  bio         TEXT,
  avatar_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Writings públicos
CREATE TABLE IF NOT EXISTS writings (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  author_id     TEXT NOT NULL REFERENCES profiles(auth_id),
  local_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  content       TEXT NOT NULL,
  excerpt       TEXT,
  category_name TEXT,
  is_public     INTEGER NOT NULL DEFAULT 1,
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(author_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_writings_published ON writings(published_at DESC) WHERE is_public = 1;
CREATE INDEX IF NOT EXISTS idx_writings_author ON writings(author_id);
