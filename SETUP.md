# Setup: triage.fillorie.nl

Order matters only for steps 1–3. Check exact option names in the Cloudflare dashboard and Google Admin console as you go.

## 1. Database (EU)

```bash
npx wrangler d1 create triage-demo --jurisdiction eu
```

Put the returned `database_id` in `wrangler.jsonc`, then:

```bash
npm run db:migrate:remote
```

The jurisdiction can only be set at creation.

## 2. Secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put MISTRAL_API_KEY      # only if you use LLM_PROVIDER=mistral
npx wrangler secret put TURNSTILE_SECRET
```

Never set `DEV_ADMIN` in production.

## 3. Turnstile

Dashboard → Turnstile → add widget for `triage.fillorie.nl` (managed or invisible). Put the site key in `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY`, the secret via step 2.

## 4. Deploy

```bash
npm run deploy
```

The `custom_domain` route creates the DNS record and certificate. `workers_dev` is off, so the Worker is only reachable on the custom domain.

## 5. Admin behind Cloudflare Access

Zero Trust → Access → Applications → self-hosted, domain `triage.fillorie.nl`, path `admin` (covers `/admin` and `/admin/api/*`). Policy: your email, one-time PIN.

Copy the team domain (e.g. `fillorie.cloudflareaccess.com`) and the application's AUD tag into `vars.ACCESS_TEAM_DOMAIN` and `vars.ACCESS_AUD`, then deploy again. The Worker verifies the Access JWT itself as well.

## 6. Inbound email, Cloudflare side

Email → Email Routing on the zone → enable for the **subdomain** `triage.fillorie.nl` only. Add a custom address `inbox@triage.fillorie.nl` → action "Send to a Worker" → `triage-demo`.

This adds MX/TXT records on the subdomain only. Check that root mail still goes to Google:

```bash
dig MX fillorie.nl +short @1.1.1.1
dig MX triage.fillorie.nl +short @1.1.1.1
```

## 7. Inbound email, Google Workspace side

1. Add `service@fillorie.nl` as an **alias** on your existing user (free, no extra licence).
2. Admin console → Apps → Google Workspace → Gmail → Default routing → Add rule:
   - Specified envelope recipients: single recipient `service@fillorie.nl`
   - Modify message → Also deliver to → add recipient `inbox@triage.fillorie.nl`
3. Don't use a Google Group: Groups can rewrite the From header, which breaks matching customers by sender domain.

**Test this early**, with a sender outside Gmail (e.g. an Outlook address). Mail relayed by Google keeps the original sender, so Cloudflare's SPF check on the relay can fail; DKIM usually survives because the message isn't changed. If Cloudflare rejects these, the email never reaches the Worker. Check Email Routing → Activity log.

## 8. Cleanup cron

`wrangler.jsonc` has one daily cron (03:17 UTC) that deletes sandboxes older than `RETENTION_DAYS`. The free plan allows 5 cron triggers per account.

## 9. Seed cache

The first real run of each seed email is cached (per model) when it lands in its expected lane; later visitors replay it with today's facts filled in. To refresh after changing prompts or the model: `/admin` → Clear cache, then process the inbox once yourself.

## 10. Record it

Add the subdomain, Email Routing, the Google routing rule and the Access app to Fillorie Configuration Management.
