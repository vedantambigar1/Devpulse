# DevPulse — Developer Portfolio & GitHub Activity Sync Widget

An embeddable, customizable widget that shows a developer's live GitHub activity — streaks, contribution graph, languages and top repos — on any portfolio or Notion page with **one snippet**. Built with Next.js 15 (App Router) + the official GitHub GraphQL API.

```html
<script src="https://your-app.com/widget.js" data-username="octocat" data-theme="dark" async></script>
```

## Quick start

```bash
npm install
cp .env.example .env.local     # add GITHUB_TOKEN (optional, see below)
npm run dev                    # http://localhost:3000
```

**No token?** The app runs in *demo mode* with deterministic generated data, so you can try every feature immediately. Add a `GITHUB_TOKEN` (a classic or fine-grained PAT with no scopes — public data only) for real data.

## What's inside

| Area | Path |
| --- | --- |
| Landing page, pricing, docs | `app/(site)/` |
| Live widget builder + snippet generator | `components/Builder.tsx` |
| Embeddable widget page (iframe target) | `app/embed/[username]` |
| One-line script embed | `public/widget.js` |
| Static SVG card (READMEs, email) | `app/api/card/[username]` |
| JSON API (GraphQL → normalised) | `app/api/github/[username]` |
| Analytics tracking + dashboard | `app/api/track`, `app/api/analytics`, `components/Dashboard.tsx` |
| Stripe checkout + webhook + license keys | `app/api/checkout`, `app/api/webhook/stripe`, `lib/license.ts` |
| Custom domains | `middleware.ts` |

## Embed options

| Param (`?x=` on `/embed/:user`, `data-x` on the script) | Values |
| --- | --- |
| `theme` | `dark` `light` `midnight` (free) · `dracula` `nord` `sunset` `neon` `forest` `rose` (Pro) |
| `show` | comma list of `profile,stats,graph,langs,repos` |
| `repos` | 1–6 |
| `radius` | 0–28 |
| `transparent` | `1` |
| `c_bg` `c_fg` `c_accent` (script: `data-bg/fg/accent`) | 6-digit hex, Pro |

Embed types supported: script tag, iframe, SVG image (`/api/card/:user.svg`), Markdown, Notion (`/embed` URL).

## Monetization ($3/mo or $5 one-time)

Pro is attached to a **GitHub username**, checked server-side, so no secret ever appears in a public embed URL.

| Feature | Free | Pro |
| --- | --- | --- |
| 3 themes, streaks, graph, repos, all embed types | ✓ | ✓ |
| 6 extra themes + custom colors | | ✓ |
| Hide "Powered by DevPulse" | | ✓ |
| Visitor analytics dashboard | | ✓ |
| Custom domain hosting | | ✓ |

1. In Stripe create two Prices — **$3/month recurring** and **$5 one-time** — and put their IDs in `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_LIFETIME`, plus `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint `https://your-app.com/api/webhook/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated` and `customer.subscription.deleted`; set `STRIPE_WEBHOOK_SECRET`.
3. Set `LICENSE_SECRET` (`openssl rand -hex 32`). **Required in production.**

On payment the webhook issues a signed license key (shown on `/success`) and activates Pro for that username. Cancelling a monthly subscription revokes it.

**Testing Pro locally without Stripe:** in dev, the pricing buttons go through a demo checkout that mints a key (`/api/dev/license`, disabled in production).

### Custom domains (Pro)

v1 is manual provisioning: point the customer's domain at your deployment, then add `host=username` to `CUSTOM_DOMAINS`. The domain root renders that user's widget page.

## Deploying

Deploy to any Node host (Vercel, Railway, Fly, a VPS).

### Storage

Licenses and analytics go through `lib/store.ts`, which has two backends and picks one automatically:

| Backend | When | Persists on Vercel? |
| --- | --- | --- |
| **Upstash Redis** | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or Vercel's `KV_REST_API_URL` / `KV_REST_API_TOKEN`) are set | Yes |
| JSON file (`.data/devpulse.json`) | nothing set; local dev or one server with a persistent disk (`DATA_DIR`) | **No** |

**Vercel setup:** project → Storage / Marketplace → add **Upstash Redis** → connect it to the project → redeploy. The env vars are injected automatically. A startup warning is logged if you deploy to Vercel without it.

Redis layout: `dp:l:<sha256(key)>` (license JSON), `dp:lu:<username>` / `dp:ls:<session>` / `dp:lsub:<subscription>` (indexes), `dp:a:<username>:total|days|refs` (analytics). Pro status is cached in memory for 60 s per instance, so a cancellation applies within a minute.

The in-memory GitHub cache and rate limiter (`lib/ratelimit.ts`) remain per-instance. That is fine for v1; swap the limiter for `@upstash/ratelimit` if abuse becomes a problem.

## Notes & next steps

- The builder accepts a username, `@handle` or GitHub profile URL. Repository URLs and other hosts are rejected.
- Run `npm test`, `npm run typecheck` and `npm run build` before deploying. Tests cover GitHub query/error handling, safe profile URL parsing, payment validation, duplicate fulfillment and analytics input handling.
- Next.js is kept on the patched 15.x line; the PostCSS override addresses advisories in Next.js's pinned dependency. Review the override when upgrading Next.js.

- Fonts are self-hosted via `@fontsource/anton` (no external font requests).
- GitHub responses are cached 15 min (`CACHE_TTL_SECONDS`) and stale data is served if GitHub errors.
- Widget views are counted per iframe load (and per SVG fetch) with the embedding site as referrer; there's no cookie or visitor identifier.
- Ideas for v2: GitHub OAuth login instead of username + key, a database, per-widget saved configs, a Notion-native "link preview", more themes.
