# Morrigan Postcards Portal

Cloudflare Workers project for postcard exchange:
- public website with postcard gallery and request form
- admin workflow through Telegram bot (adding/deleting postcards, monitoring requests)
- Cloudflare D1 + R2 storage, protected request form with Turnstile

## Stack

- Runtime: Cloudflare Workers (`src/worker.js`)
- Frontend: static HTML/CSS/JS from `public/`
- Database: Cloudflare D1 (`cards`, `requests`, `admin_actions`, `admin_events`, `analytics_daily`)
- Media storage: Cloudflare R2 bucket (`postcards`)
- Bot integration: Telegram Bot API webhooks
- Tests: Vitest (`src/worker.test.js`, `public/app.test.js`)

## Features

- Browse postcards with category filter and search by ID
- Add postcards to cart and send one request for multiple items
- Automatic card reservation (`pending`) after request to prevent race conditions
- Duplicate request suppression window
- Auto-refreshing gallery without full page reload
- Telegram admin controls:
  - upload new postcards from chat
  - delete single postcard or bulk delete from request message
  - recent admin events and analytics commands

## Project Structure

- `src/worker.js` - Worker API, Telegram webhook handling, D1/R2 logic
- `public/index.html` - website markup
- `public/style.css` - website styles
- `public/app.js` - website interaction logic
- `schema.sql` - full database schema for fresh setup
- `migrations/` - incremental D1 migrations for existing DB
- `.github/workflows/ci.yml` - lint + test CI

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

## Deploy

```bash
npx wrangler deploy
```

## API Overview

- `GET /api/cards` - list cards for website (supports category filter)
- `GET /api/categories` - available categories
- `POST /api/request` - submit postcard request (Turnstile protected)
- `GET /api/config` - public runtime config for frontend
- `POST /tg` - Telegram webhook endpoint

## Notes

- End users interact only with the website; Telegram is used internally for admin operations.
- Scheduled Worker task releases expired reservations and cleans expired admin actions.
