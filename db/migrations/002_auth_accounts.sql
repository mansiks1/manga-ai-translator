-- Email is compared case-insensitively so User@Example.com and user@example.com
-- cannot become two different accounts.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

-- Reserved for a future confirmation-email flow. Registration itself does not
-- mark the address as verified until an email provider is connected.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
