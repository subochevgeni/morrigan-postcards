# Morrigan Postcards Portal

Cloudflare Workers project for postcard exchange:
- public website with postcard gallery and request form
- admin workflow through Telegram bot (adding/deleting postcards, monitoring requests)
- Cloudflare D1 + R2 storage, protected request form with Turnstile

## Stack

- Runtime: Cloudflare Workers (`src/worker.js`)
- Frontend: static HTML/CSS/JS from `public/`
- Database: Cloudflare D1 (`cards`, `requests`, `exchange_proposals`, `admin_actions`, `admin_events`, `analytics_daily`, `site_access_state`, `request_rate_limits`, `error_alerts`)
- Media storage: Cloudflare R2 bucket (`postcards`)
- Bot integration: Telegram Bot API webhooks
- Tests: Vitest (`src/worker.test.js`, `public/app.test.js`)

## Features

- Browse postcards with category filter and search by ID
- Add postcards to cart and send one request for multiple items
- Optional exchange-offer mode: user can request up to 3 cards and attach up to 3 offered cards
- Exchange proposal lifecycle in Telegram (`new`, `accepted`, `declined`, `completed`) with inline actions
- Automatic card reservation (`pending`) after request to prevent race conditions
- Duplicate request suppression window
- Request guard with basic input validation and IP-based throttling for `/api/request`
- Auto-refreshing gallery without full page reload
- Telegram admin controls:
  - upload new postcards from chat
  - delete single postcard or bulk delete from request message
  - list exchange proposals via `/exchange [n] [status]`
  - recent admin events and analytics commands
  - view and rotate private access phrase (`/accessword`, `/rotateaccess`)

## Project Structure

- `src/worker.js` - Worker API, Telegram webhook handling, D1/R2 logic
- `public/index.html` - website markup
- `public/style.css` - website styles
- `public/app.js` - website interaction logic
- `schema.sql` - full database schema for fresh setup
- `migrations/` - incremental D1 migrations for existing DB
- `.github/workflows/ci.yml` - CI: lint + tests + `npm audit` + gitleaks

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run quality checks:
   ```bash
   npm run check
   ```
3. Optional:
   ```bash
   npm run test:watch
   npm run test:coverage
   npm run format
   ```

## Configuration

### Cloudflare bindings (wrangler)

Configured in `wrangler.jsonc`:
- `DB` - D1 database binding
- `BUCKET` - R2 bucket binding
- `ASSETS` - static assets binding
- `triggers.crons` - scheduled maintenance task

### Environment variables

- `SITE_URL` - base site URL used in links and webhook setup
- `TURNSTILE_SITE_KEY` - public site key returned by `/api/config`
- `TURNSTILE_SECRET_KEY` - secret key for server-side Turnstile verification
- `TG_BOT_TOKEN` - Telegram bot token
- `TG_WEBHOOK_SECRET` - optional Telegram webhook secret token
- `TG_STRICT_WEBHOOK_SECRET` - strict mode for webhook secret checking (`true/1`)
- `ADMIN_CHAT_ID` - single admin chat ID
- `ADMIN_CHAT_IDS` - optional comma-separated admin chat IDs
- `SITE_ACCESS_PHRASE` - enables private access gate (secret word for site visitors; initial/fallback value)
- `SITE_ACCESS_PHRASE_PREVIOUS` - optional previous phrase accepted during rotation (fallback)
- `SITE_ACCESS_PHRASES` - optional comma-separated phrases (fallback; overrides single/previous vars)
- `SITE_ACCESS_SIGNING_KEY` - optional separate key for access cookie signature
- `SITE_ACCESS_SIGNING_KEYS` - optional comma-separated signing keys accepted for cookie validation
- `SITE_ACCESS_TTL_DAYS` - optional access lifetime in days (`14` by default)

Private access endpoints:
- `POST /api/unlock` - validates secret word and sets access cookie
- `POST /api/logout` - clears access cookie

## Database

For a new database, apply full `schema.sql`.

For existing databases, use migrations:

```bash
npx wrangler d1 migrations apply postcards --remote
```

Current migrations:
- `0001_add_category.sql`
- `0002_admin_actions.sql`
- `0003_reservations_audit_analytics.sql`
- `0004_site_access_state.sql`
- `0005_exchange_proposals.sql`
- `0006_request_guard_exchange_lifecycle_and_error_alerts.sql`

## Deploy

```bash
npx wrangler deploy
```

## API Overview

- `GET /api/cards` - list cards for website (supports category filter)
- `GET /api/categories` - available categories
- `POST /api/request` - submit postcard request or exchange offer (Turnstile protected)
- `GET /api/config` - public runtime config for frontend
- `POST /tg` - Telegram webhook endpoint

## Notes

- End users interact only with the website; Telegram is used internally for admin operations.
- Scheduled Worker task releases expired reservations, cleans expired admin actions, and prunes old request/error guard rows.
