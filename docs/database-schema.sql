-- Draft schema for the future paid product.
-- This is intentionally provider-neutral: Stripe, YooKassa, Paddle, etc. can map into payments.

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    credits_balance INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_payment_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    credits_granted INTEGER NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_payment_id),
    UNIQUE(idempotency_key)
);

CREATE TABLE credit_ledger (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    idempotency_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(idempotency_key)
);

CREATE TABLE usage_events (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    ip_hash TEXT,
    event_type TEXT NOT NULL,
    query_hash TEXT,
    credits_charged INTEGER NOT NULL DEFAULT 0,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    provider TEXT,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE translation_jobs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    source_site TEXT NOT NULL,
    manga_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    status TEXT NOT NULL,
    credits_reserved INTEGER NOT NULL DEFAULT 0,
    credits_charged INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usage_events_user_created_idx ON usage_events(user_id, created_at DESC);
CREATE INDEX usage_events_ip_created_idx ON usage_events(ip_hash, created_at DESC);
CREATE INDEX translation_jobs_user_created_idx ON translation_jobs(user_id, created_at DESC);

-- Executable, versioned schema:
-- db/migrations/001_accounts_and_billing.sql
