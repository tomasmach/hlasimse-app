# CLAUDE.md

This file provides repository guidance for coding agents working on Hlásím se.

## Product

Hlásím se is a Czech, completely free check-in service. A user confirms they are
safe before a server-authoritative deadline. If the deadline passes, the server
creates an incident and attempts to notify accepted guardians.

This is safety-adjacent software. It does not replace 112 or 155, and push
delivery is best-effort. Never present a locally queued offline request as a
confirmed check-in. The normative behavior and release gates live in
`docs/feature-contract.md` and `docs/release-checklist.md`.

## Monorepo

```text
apps/mobile/       Expo Router app for iOS and Android
apps/server/       Django web, REST API, scheduler and delivery workers
archive/supabase/  read-only legacy code for migration audit only
docs/              architecture, migration and operational runbooks
```

Supabase and RevenueCat are not runtime dependencies. Every supported feature is
available without payment.

## Commands

From the repository root:

```bash
npm ci
npm test
npm run typecheck
npm run mobile:start
npm run mobile:ios
npm run mobile:android
```

For the Django server (Python 3.14 and uv are required):

```bash
cd apps/server
uv sync --frozen
uv run python manage.py migrate
uv run python manage.py runserver
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Use PostgreSQL for concurrency validation:

```bash
DATABASE_URL=postgresql:///hlasimse_validation uv run pytest
```

Production requires the deadline sweeper, outbox processor and push receipt
worker to run independently. See the management commands and operational
runbooks before changing their cadence or retry behavior.

## Architecture rules

- Django/PostgreSQL is the only source of truth for accounts, deadlines,
  incidents, guardian relationships and delivery audit.
- Critical transitions are transactional and idempotent. Preserve row locking,
  database constraints and outbox semantics.
- The client generates a stable idempotency key for every check-in attempt.
- Offline requests remain visibly pending and do not advance the displayed
  authoritative deadline until the API confirms them.
- Exact location is optional, excluded from push/logs, and visible to a current
  guardian only during an open incident.
- A guardian relationship exists only after the invited account accepts it.
- Public behavior is limited to 5 profiles per account, 5 active guardians per
  profile and intervals from 1 hour through 7 days.
- SMS is not part of the product.

## Code conventions

- User-facing copy is Czech; code and comments are English.
- TypeScript stays in strict mode.
- Mobile UI uses NativeWind and the existing design tokens.
- Web UI uses semantic Django templates, local assets and progressive
  enhancement.
- Accessibility is mandatory for every critical action: readable dynamic text,
  screen-reader labels, non-color status cues, adequate contrast and reduced
  motion support.

## Configuration

Mobile requires `EXPO_PUBLIC_API_URL`. Production values must use HTTPS.

Server configuration is documented in `apps/server/.env.example`. Production
must use PostgreSQL, HTTPS, a strong secret key, SMTP and valid Expo push
credentials. Never commit secrets or real user exports.
