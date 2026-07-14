# Production Architecture

This project should move toward a staged production stack instead of one large rewrite.

## Recommended Stack

```txt
Next.js web app
  - public search UI
  - user account pages
  - credits and billing UI
  - translation history

Node.js API
  - normal search
  - deep search
  - source adapters
  - AI query generation
  - auth/session checks
  - payments and credit ledger

PostgreSQL
  - users
  - payments
  - credit ledger
  - search usage
  - translation jobs

Redis
  - shared cache
  - rate limits
  - short locks
  - future job queues

Python FastAPI worker
  - OCR
  - image preparation
  - page-level translation pipeline
```

## Migration Order

1. Keep the current Node backend working.
2. Add PostgreSQL models for users, payments, credits, and usage.
3. Replace in-memory cache/rate limits with Redis.
4. Move the frontend to Next.js.
5. Add paid deep search behind account credits.
6. Add a Python OCR/translation worker only when chapter image processing starts.

Current progress: the optional PostgreSQL account store, hashed sessions, atomic credit ledger, and SQL migration are implemented. Real registration and payment webhooks are the next backend milestone.

## Why Not Rewrite Everything Now

The current backend already owns the hardest search logic: source adapters, merging, ranking, deep search, AI query generation, cache, and rate limits. Rewriting that before payments and translation exist would add risk without giving users a better product.

Next.js should be introduced for the user-facing app and account flows. FastAPI should be introduced later for Python-heavy OCR and translation jobs.
