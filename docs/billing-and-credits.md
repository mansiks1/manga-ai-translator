# Billing And Credits

The site should not store a money balance. Store internal credits instead.

## Current Storage Layer

The Node backend uses one account-store contract with two implementations:

- Without `DATABASE_URL`: in-memory users and ledger for local development.
- With `DATABASE_URL`: PostgreSQL users, hashed sessions, balances, and ledger entries.

- `GET /api/me` creates or restores a local HttpOnly cookie session.
- `POST /api/auth/register` upgrades that anonymous user without losing credits.
- `POST /api/auth/login` verifies a scrypt password hash and rotates the session.
- `POST /api/auth/logout` revokes the current session server-side.
- `POST /api/dev/add-credits` adds a fixed test amount outside production.
- A successful deep-search cache miss costs 1 credit.
- Cache hits and shared in-flight requests cost 0 credits.
- A reserved credit is refunded when every external source fails.
- Credit updates are atomic and idempotent in both storage modes.

PostgreSQL now provides persistent registered accounts. Email verification, password recovery, payment webhooks, origin/CSRF checks, and distributed rate limits remain required before accepting payments.

## Product Rules

- Normal search is free.
- Deep search costs 1 credit only when it is not served from cache.
- AI translation costs credits by chapter or by page.
- Cached repeated work should not charge again during the cache window.
- All credit changes must be written to an append-only ledger.

## Suggested Starting Prices

```txt
One-time pack:
  $2.00 -> 200 credits

Subscription:
  $4.99/month -> 500-700 credits
  $9.99/month -> 1500-2000 credits
```

Deep search is cheap, so its price mostly prevents abuse. Translation will be the real cost center.

## Payment Flow

```txt
User starts checkout
-> payment provider creates checkout session
-> user pays
-> webhook confirms payment
-> server verifies webhook signature
-> server writes payment row
-> server writes credit_ledger row
-> user credits increase
```

Never trust frontend payment state. Credits should be granted only from a verified webhook.

## Anti-Abuse Rules

- Require accounts for paid deep search and AI translation.
- Keep IP-based limits even for logged-in users.
- Add per-account daily limits for AI work.
- Use idempotency keys for payment webhooks.
- Use an append-only credit ledger.
- Never allow negative credit balance.
- Do not charge for failed AI/provider calls.
- Do not charge again for fresh cache hits.
