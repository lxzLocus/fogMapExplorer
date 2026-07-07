-- Fog Explorer schema (idempotent; executed on backend startup)

-- Registered users (email + bcrypt password hash). Optional: the app also
-- works for anonymous "guest" devices.
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One state document per owner. `owner` is either:
--   user:<id>       for a logged-in account, or
--   device:<uuid>   for an anonymous guest device.
CREATE TABLE IF NOT EXISTS states (
  owner       TEXT PRIMARY KEY,
  pos         JSONB,
  visited     JSONB NOT NULL DEFAULT '[]'::jsonb,
  cells       JSONB NOT NULL DEFAULT '[]'::jsonb,
  discoveries JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_dist  DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
