# Hello — Postcards

Small Cloudflare Workers app to serve postcards and accept requests via a form + Telegram.

## Local tasks

- Install: `npm install`
- Run tests: `npm test`
- Run linter: `npm run lint`
- Format: `npm run format`

## Notes

- Secrets (bot token, D1/R2 credentials) are provided via Cloudflare vars in `wrangler.jsonc` / environment.
- Public Turnstile site key (non-secret) is exposed via `/api/config`.
