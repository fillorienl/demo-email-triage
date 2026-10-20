# Setup guide

How to run the email triage demo locally, deploy it to `triage.fillorie.nl`, and connect live email from `service@fillorie.nl`.

- **Part A** (local) takes 5 minutes and needs no accounts.
- **Parts B–D** need the Cloudflare account that hosts fillorie.nl and Google Workspace admin access.

Option names in the Cloudflare dashboard and the Google Admin console change now and then. If a label below doesn't match exactly, look for the closest one.

---

## Part A: Run locally

### A1. Install

Requirements: Node 22 or newer, npm.

```bash
npm install
```

npm may block install scripts. `workerd` (the local Workers runtime) and `esbuild` are already allowed in `package.json` → `allowScripts`. If `npm run dev` complains about workerd, run `npm rebuild workerd esbuild`.

### A2. Local settings

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` is gitignored. It starts in **offline test mode** (`AI_MODE=fixture`): the 11 seed emails use prepared results from `seed/expected/`, so no AI is called and no key is needed. Typed and live emails don't work in this mode.

To use real AI, edit `.dev.vars`:

```ini
AI_MODE=live
ANTHROPIC_API_KEY=sk-ant-...
# optional, default claude-sonnet-5-5:
ANTHROPIC_MODEL=claude-sonnet-5-5
```

For Mistral (EU-hosted) instead:

```ini
AI_MODE=live
LLM_PROVIDER=mistral
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-medium-latest
```

Restart the dev server after any change to `.dev.vars`.

### A3. Local database and start

```bash
npm run db:migrate:local
npm run dev
```

Open <http://localhost:5173> and click **Process inbox**. The bot check uses Cloudflare's always-pass test keys locally. `/admin` is open locally because `.dev.vars` sets `DEV_ADMIN=1`.

### A4. Tests

```bash
npm test           # rules, lanes and grounding for all 11 seed emails, on five different dates
npm run typecheck
```

### A5. Test an incoming email locally

Copy the sandbox code from the sidebar (e.g. `VEL-7K3`) into the subject:

```bash
curl -X POST "http://localhost:5173/cdn-cgi/handler/email?from=inkoop@hofstede-machinebouw.nl&to=inbox@triage.fillorie.nl" \
  --data-binary $'From: Ruud <inkoop@hofstede-machinebouw.nl>\nTo: service@fillorie.nl\nSubject: VEL-7K3 waar is PO 4471\n\nHoi, waar blijft PO 4471?'
```

The email appears in the inbox within a few seconds. In offline test mode it shows "failed", because only seed emails have prepared results.

---

## Part B: Deploy to triage.fillorie.nl

Log in once with `npx wrangler login`, using the account that holds the fillorie.nl zone.

### B1. Check the cron trigger budget

The free plan allows 5 cron triggers per account, and this Worker uses 1. Check what's in use: Workers & Pages → each Worker → Settings → Triggers. The `fillorienl` and `esl_hub` Workers in this workspace have none in their `wrangler.jsonc`.

### B2. Create the database (EU)

```bash
npx wrangler d1 create triage-demo --jurisdiction eu
```

Copy the `database_id` from the output into `wrangler.jsonc` → `d1_databases[0].database_id`. The jurisdiction can only be set here, at creation. Then create the tables:

```bash
npm run db:migrate:remote
```

### B3. Turnstile (bot check)

Dashboard → Turnstile → **Add widget**:

- Hostname: `triage.fillorie.nl`
- Mode: **Managed**

Put the **site key** in `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY`. The secret key goes in the next step.

### B4. Secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put MISTRAL_API_KEY      # only if LLM_PROVIDER=mistral
```

Use a **separate API key for this demo**, with a monthly spend limit in the Anthropic Console. The demo is public, and a separate key keeps its cost apart and capped.

Never set `DEV_ADMIN` in production: it opens `/admin` to everyone.

### B5. Check the settings

In `wrangler.jsonc` → `vars`:

| Variable | Default | What it does |
| --- | --- | --- |
| `AI_MODE` | `live` | `fixture` replays prepared results for seed emails only |
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `mistral` |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for both the read and the draft step |
| `MISTRAL_MODEL` | `mistral-medium-latest` | Used when `LLM_PROVIDER=mistral` |
| `CAP_SANDBOX_LIVE_PER_DAY` | `20` | Typed and live emails per visitor per day |
| `CAP_GLOBAL_AI_CALLS_PER_DAY` | `300` | All AI calls per day, across all visitors |
| `RETENTION_DAYS` | `7` | Sandboxes older than this are deleted daily |
| `INBOUND_ADDRESS` | `service@fillorie.nl` | Shown to visitors as the address to email |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | empty | Filled in at step B7 |

### B6. Deploy

```bash
npm run deploy
```

The `custom_domain` route creates the DNS record and certificate for `triage.fillorie.nl` itself. `workers_dev` is off, so there is no `*.workers.dev` URL around the admin protection.

Check: open <https://triage.fillorie.nl>, click **Process inbox**, and confirm the 11 emails land as 4 / 2 / 4 / 1. The first run uses live AI and fills the seed cache. Later visitors see "cached AI result".

### B7. Protect /admin with Cloudflare Access

Zero Trust → Access → Applications → **Add an application** → Self-hosted:

- Domain: `triage.fillorie.nl`, path: `admin`. This covers `/admin` and `/admin/api/*`.
- Policy: Allow, include → Emails → your address. Login method: one-time PIN.

Then copy two values into `wrangler.jsonc` → `vars` and deploy again:

- `ACCESS_TEAM_DOMAIN`: your team domain, e.g. `fillorie.cloudflareaccess.com` (Zero Trust → Settings → Custom pages / General).
- `ACCESS_AUD`: the application's **Application Audience (AUD) tag**, on the application's overview.

The Worker checks the Access token itself as well. Without these two values the admin API stays closed.

Check: <https://triage.fillorie.nl/admin> asks for a PIN, and after login shows usage and the seed cache.

---

## Part C: Live email from service@fillorie.nl

The flow: a prospect emails `service@fillorie.nl`. Google delivers it to your mailbox and adds a copy to `inbox@triage.fillorie.nl`. Cloudflare Email Routing hands that copy to the Worker, and the code in the subject picks the visitor's sandbox.

### C1. Cloudflare Email Routing (subdomain only)

Dashboard → fillorie.nl → Email → Email Routing:

1. Enable Email Routing for the **subdomain** `triage.fillorie.nl`, not the root domain. Cloudflare adds MX and TXT records for the subdomain only.
2. Routing rules → Custom address `inbox@triage.fillorie.nl` → Action: **Send to a Worker** → `triage-demo`.

Check that root mail still goes to Google:

```bash
dig MX fillorie.nl +short @1.1.1.1          # must still list Google's servers
dig MX triage.fillorie.nl +short @1.1.1.1   # Cloudflare's route*.mx.cloudflare.net
```

### C2. Google Workspace

1. **Alias:** Admin console → Directory → Users → your user → User information → Alternate email addresses (email aliases) → add `service`. This is free; no extra licence.
2. **Routing rule:** Apps → Google Workspace → Gmail → **Default routing** → Configure:
   - Specified envelope recipients to match: **Single recipient**, `service@fillorie.nl`
   - If the envelope recipient matches: **Modify message** → **Also deliver to** → Add more recipients → `inbox@triage.fillorie.nl`
   - Save. Changes can take up to an hour to apply.

Don't use a Google Group for this. Groups can rewrite the From header, which breaks matching customers by sender domain.

### C3. Test it, early, with two senders

Send one email from Gmail and one from a non-Google address (Outlook, or a work address). Put the sandbox code from the sidebar in each subject.

- Both should appear in that sandbox's inbox within about 30 seconds, and be triaged.
- If the non-Google one never arrives, Cloudflare probably rejected the relayed message on a sender check. Look in Email Routing → **Activity log** for the reason.
- Emails without a valid code don't show anywhere. They're counted as `inbound_unmatched` on `/admin`, and your mailbox keeps its copy.

---

## Part D: Before showing it to anyone

Run through this once after deploying (it follows the plan's acceptance criteria):

- [ ] Seed inbox lands as 4 Ready, 2 Needs a look, 4 Escalated, 1 Archived on three fresh sandboxes in a row (private windows)
- [ ] Read all ready drafts: correct language (NL / EN / DE), no date, number or link that isn't in the facts
- [ ] #10 shows no draft and no credit
- [ ] Send on #3 creates an RMA under Orders & outbox → RMAs
- [ ] A live email with the code arrives and is triaged within ~30 s
- [ ] Two browsers never see each other's emails; Reset in one leaves the other alone
- [ ] `/admin` asks for a PIN; the AI call counter goes up as expected
- [ ] `dig MX fillorie.nl` still shows Google
- [ ] Look at the board on a phone

Then add the subdomain, Email Routing rule, Google routing rule, Access app and D1 database to Fillorie Configuration Management.

---

## Maintenance

**Change the model or prompts.** Change `ANTHROPIC_MODEL` (or the prompts in `worker/ai/prompts.ts`) and deploy. Seed results are cached per model, so a new model starts fresh. After changing prompts on the same model, use `/admin` → **Clear cache**, then process the inbox once yourself to refill it. A run is only cached when every email lands in its expected lane.

**Adjust caps.** Edit the two `CAP_*` values in `wrangler.jsonc` and deploy. When a cap is hit, visitors see a plain message; seed emails keep working from the cache.

**Clean up by hand.** Use `/admin` → Delete all sandboxes, or `npx wrangler d1 execute triage-demo --remote --command "DELETE FROM sandboxes"`.

**Schema changes.** Add a new file under `migrations/`, then run `npm run db:migrate:remote`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "The bot check failed" | `TURNSTILE_SECRET` doesn't match the site key, or the widget's hostname isn't `triage.fillorie.nl` |
| Emails show "failed: ANTHROPIC_API_KEY is not set" | Secret missing: `npx wrangler secret put ANTHROPIC_API_KEY` |
| "Offline test mode only covers the 11 seed emails" | `AI_MODE=fixture` is set in `.dev.vars` or `wrangler.jsonc` |
| `/admin` says "Admin only" after the PIN | `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` wrong or missing |
| Live emails never arrive | Check the Email Routing activity log, then the Google routing rule (it can take up to an hour), then that the subject contains the code |
| Live email arrives but lands in the wrong lane | Expected for unknown senders: they get "ask for order number". Mention PO 4471 to show a lookup |
| Worker errors about CPU time | Very large HTML emails. Inbound mail is capped at 256 KB; lower `MAX_RAW_BYTES` in `worker/inbound.ts`, or move to Workers Paid ($5/month) |
