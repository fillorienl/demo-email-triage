# Setup guide

How to run the email triage demo locally, deploy it from GitHub to `demos.fillorie.nl/email-triage`, and connect live email from `triage-service@fillorie.nl`.

- **Part A** (local) takes 5 minutes and needs no accounts.
- **Parts B–D** need the Cloudflare account that hosts fillorie.nl, admin access to the `fillorienl/demo-email-triage` GitHub repo, and Google Workspace admin access.

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
# optional, overrides the model in wrangler.jsonc (claude-haiku-5-5):
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

Open <http://localhost:5173/email-triage/> and click **Process inbox**. The bot check uses Cloudflare's always-pass test keys locally. `/admin` is open locally because `.dev.vars` sets `DEV_ADMIN=1`.

### A4. Tests

```bash
npm test           # rules, lanes and grounding for all 11 seed emails, on five different dates
npm run typecheck
```

### A5. Test an incoming email locally

Copy the sandbox code from the sidebar (e.g. `VEL-7K3`) into the subject:

```bash
curl -X POST "http://localhost:5173/cdn-cgi/handler/email?from=inkoop@hofstede-machinebouw.nl&to=inbox@triage.fillorie.nl" \
  --data-binary $'From: Ruud <inkoop@hofstede-machinebouw.nl>\nTo: triage-service@fillorie.nl\nSubject: VEL-7K3 waar is PO 4471\n\nHoi, waar blijft PO 4471?'
```

The email appears in the inbox within a few seconds. In offline test mode it shows "failed", because only seed emails have prepared results.

---

## Part B: Deploy from GitHub to demos.fillorie.nl/email-triage

Cloudflare Workers Builds deploys the Worker from the GitHub repo: every push to `main` builds and deploys it. The build only uses what is committed, so everything the Worker needs at deploy time (database id, routes, `vars`) lives in `wrangler.jsonc`.

A few one-time steps happen outside the build: creating the database and its tables (B2), and adding secrets (B7). For B2, log in once with `npx wrangler login`, using the account that holds the fillorie.nl zone.

### B1. Check the cron trigger budget

The free plan allows 5 cron triggers per account, and this Worker uses 1. Check what's in use: Workers & Pages → each Worker → Settings → Triggers. The `fillorienl` and `esl_hub` Workers in this workspace have none in their `wrangler.jsonc`.

### B2. Create the database (EU)

```bash
npx wrangler d1 create triage-demo --jurisdiction eu
```

Copy the `database_id` from the output into `wrangler.jsonc` → `d1_databases[0].database_id`. The jurisdiction can only be set here, at creation. If `wrangler.jsonc` already has a real id (not all zeros), the database exists; skip to the migration.

Create the tables:

```bash
npm run db:migrate:remote
```

Builds don't run migrations. Run this from your machine whenever a new file lands in `migrations/` (see Maintenance).

### B3. Turnstile (bot check)

Dashboard → Turnstile → **Add widget**:

- Name: `triage-demo`, hostname: `demos.fillorie.nl`. The demo hub's widget uses the same hostname; a separate widget keeps each one's keys and stats apart.
- Mode: **Managed**

Put the **site key** in `wrangler.jsonc` → `vars.TURNSTILE_SITE_KEY`. The secret key is added in step B7.

### B4. Check the settings

In `wrangler.jsonc` → `vars`:

| Variable | Value | What it does |
| --- | --- | --- |
| `AI_MODE` | `live` | `fixture` replays prepared results for seed emails only |
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `mistral` |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Model for both the read and the draft step |
| `MISTRAL_MODEL` | `mistral-medium-latest` | Used when `LLM_PROVIDER=mistral` |
| `TURNSTILE_SITE_KEY` | from B3 | Public site key of the Turnstile widget |
| `CAP_SANDBOX_LIVE_PER_DAY` | `20` | Typed and live emails per visitor per day |
| `CAP_GLOBAL_AI_CALLS_PER_DAY` | `300` | All AI calls per day, across all visitors |
| `RETENTION_DAYS` | `7` | Sandboxes older than this are deleted daily |
| `INBOUND_ADDRESS` | `triage-service@fillorie.nl` | Shown to visitors as the address to email; must match the alias in C2 |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | empty | Filled in at step B9 |

Every build applies these `vars` as written. A plain-text variable added in the dashboard is removed by the next build, so change them here, not in the dashboard. Secrets (B7) are kept across builds.

### B5. Commit and push

The first build needs the database id and the Turnstile site key on `main`:

```bash
git add wrangler.jsonc
git commit -m "chore: production database and Turnstile site key"
git push origin main
```

Never commit `.dev.vars`; it's gitignored.

### B6. Connect the repo to Cloudflare

Dashboard → Workers & Pages → **Create application** → **Import a repository** → GitHub. If asked, install the Cloudflare GitHub app on the `fillorienl` organisation and give it access to `demo-email-triage` only.

| Setting | Value |
| --- | --- |
| Project name | `triage-demo`. Must equal `name` in `wrangler.jsonc`, or the build fails |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` (leave empty) |
| Builds for non-production branches | **Off** |
| Build variables | `NODE_VERSION` = `22` |

Why these values:

- Don't leave the build command empty. `vite build` writes `dist/` and a generated Wrangler config that points at the built assets; `wrangler deploy` picks that up. `wrangler.jsonc` on its own has no assets directory.
- Dependencies install automatically from `package-lock.json`, so `npm install` isn't part of the build command.
- Non-production branch builds upload versions with preview URLs. Those can reach `/admin` around Access, and they share the production database. Keep them off.

**Save and Deploy.** If a `triage-demo` Worker already exists (from an earlier CLI deploy), open it instead → Settings → Build → **Connect**, with the same values.

Follow the build under the Worker → **Deployments** → View build. The first build can finish before the secrets exist; the next step fixes that without a new build.

### B7. Secrets

Worker `triage-demo` → Settings → **Variables and Secrets** → Add, type **Secret**:

- `ANTHROPIC_API_KEY`
- `TURNSTILE_SECRET` (the secret key from B3)
- `MISTRAL_API_KEY`, only if `LLM_PROVIDER=mistral`

Saving deploys them right away; no push needed. Don't put them under Settings → Build → Variables and secrets: those exist only during the build, not in the running Worker. From a terminal, `npx wrangler secret put ANTHROPIC_API_KEY` does the same.

Use a **separate API key for this demo**, with a monthly spend limit in the Anthropic Console. The demo is public, and a separate key keeps its cost apart and capped.

Never set `DEV_ADMIN` in production: it opens `/admin` to everyone.

### B8. Check the deployment

The demo runs on two Worker routes, `demos.fillorie.nl/email-triage` and `demos.fillorie.nl/email-triage/*`, which the build creates from `wrangler.jsonc`. `demos.fillorie.nl` itself is the demo-hub Worker's custom domain, so deploy the hub first: it creates the DNS record and certificate. Routes run before a custom domain, so requests under `/email-triage` reach this Worker and everything else stays with the hub.

The path is set in three places that must match: `base` in `vite.config.ts`, `routes` and `assets` in `wrangler.jsonc`, and `BASE` in `worker/index.ts`.

Check:

1. Worker → Settings → **Domains & Routes** lists both routes, and both `workers.dev` and **Preview URLs** are disabled. Either one would be a way around the admin protection.
2. Open <https://demos.fillorie.nl/email-triage/>, click **Process inbox**, and confirm the 11 emails land as 4 / 2 / 4 / 1. The first run uses live AI and fills the seed cache. Later visitors see "cached AI result".

### B9. Protect /admin with Cloudflare Access

Zero Trust → Access → Applications → **Add an application** → Self-hosted:

- Domain: `demos.fillorie.nl`, path: `email-triage/admin`. This covers `/email-triage/admin` and `/email-triage/admin/api/*`.
- Policy: Allow, include → Emails → your address. Login method: one-time PIN.

Then copy two values into `wrangler.jsonc` → `vars`, commit and push to `main`. The build deploys them.

- `ACCESS_TEAM_DOMAIN`: your team domain, e.g. `fillorie.cloudflareaccess.com` (Zero Trust → Settings → Custom pages / General).
- `ACCESS_AUD`: the application's **Application Audience (AUD) tag**, on the application's overview.

The Worker checks the Access token itself as well. Without these two values the admin API stays closed.

Check, once the build is done: <https://demos.fillorie.nl/email-triage/admin> asks for a PIN, and after login shows usage and the seed cache.

---

## Part C: Live email from `triage-service@fillorie.nl`

The flow: a prospect emails `triage-service@fillorie.nl`. Google delivers it to your mailbox and adds a copy to `inbox@triage.fillorie.nl`. Cloudflare Email Routing hands that copy to the Worker, and the code in the subject picks the visitor's sandbox.

### C1. Cloudflare Email Routing (subdomain only)

Dashboard → fillorie.nl → Email → Email Routing:

1. Enable Email Routing for the **subdomain** `triage.fillorie.nl`, not the root domain. Cloudflare adds MX and TXT records for the subdomain only.
2. Routing rules → Custom address `inbox@triage.fillorie.nl` → Action: **Send to a Worker** → `triage-demo`. The Worker exists once the first build (B6) has deployed.

Check that root mail still goes to Google:

```bash
dig MX fillorie.nl +short @1.1.1.1          # must still list Google's servers
dig MX triage.fillorie.nl +short @1.1.1.1   # Cloudflare's route*.mx.cloudflare.net
```

### C2. Google Workspace

1. **Alias:** Admin console → Directory → Users → your user → User information → Alternate email addresses (email aliases) → add `triage-service`. This is free; no extra licence. It must match `INBOUND_ADDRESS` in `wrangler.jsonc`.
2. **Routing rule:** Apps → Google Workspace → Gmail → **Default routing** → Configure:
   - Specified envelope recipients to match: **Single recipient**, `triage-service@fillorie.nl`
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
- [ ] `workers.dev` and Preview URLs are off for `triage-demo`
- [ ] A push to a branch other than `main` doesn't deploy
- [ ] `dig MX fillorie.nl` still shows Google
- [ ] Look at the board on a phone

Then add the GitHub connection, Worker routes, Email Routing rule, Google routing rule, Access app and D1 database to Fillorie Configuration Management.

---

## Maintenance

**Deploying.** Merge or push to `main`; Workers Builds deploys it in a minute or two. Build logs are under the Worker → Deployments. To undo a bad deploy, pick an earlier version there → **Rollback**. A rollback doesn't touch the database. In an emergency, `npm run deploy` from a clean checkout of `main` deploys from your machine; push the same code afterwards so the next build doesn't overwrite it with something else.

**Change the model or prompts.** Change `ANTHROPIC_MODEL` (or the prompts in `worker/ai/prompts.ts`) and push to `main`. Seed results are cached per model, so a new model starts fresh. After changing prompts on the same model, use `/admin` → **Clear cache** once the build is live, then process the inbox once yourself to refill it. A run is only cached when every email lands in its expected lane.

**Adjust caps.** Edit the two `CAP_*` values in `wrangler.jsonc` and push to `main`. When a cap is hit, visitors see a plain message; seed emails keep working from the cache.

**Rotate a secret.** Worker → Settings → Variables and Secrets → edit the value. It takes effect immediately; no push needed.

**Clean up by hand.** Use `/admin` → Delete all sandboxes, or `npx wrangler d1 execute triage-demo --remote --command "DELETE FROM sandboxes"`.

**Schema changes.** Add a new file under `migrations/` and run `npm run db:migrate:remote` from your machine **before** pushing code that depends on it. Builds don't apply migrations, so new code against an old schema fails until you do.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Build fails: Worker name doesn't match | The Worker in the dashboard isn't named `triage-demo`, the `name` in `wrangler.jsonc` |
| Build fails with an authentication or permission error on routes | The build's API token can't edit Workers routes on fillorie.nl. Worker → Settings → Build → API token: use one with Workers Scripts: Edit and Zone → Workers Routes: Edit for fillorie.nl |
| Build succeeds but the page is blank or 404 | Build command is empty, so no assets were built. Set it to `npm run build` |
| A push didn't deploy | It went to a branch other than `main`, or the Cloudflare GitHub app lost access to the repo (GitHub → organisation settings → GitHub Apps) |
| A variable changed in the dashboard reverted | Builds apply `vars` from `wrangler.jsonc`. Change it there and push |
| "The bot check failed" | `TURNSTILE_SECRET` doesn't match the site key, or the widget's hostname isn't `demos.fillorie.nl` |
| Emails show "failed: ANTHROPIC_API_KEY is not set" | Secret missing: add it under Settings → Variables and Secrets (B7) |
| "Offline test mode only covers the 11 seed emails" | `AI_MODE=fixture` is set in `.dev.vars` or `wrangler.jsonc` |
| `/admin` says "Admin only" after the PIN | `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` wrong or missing, or the push with them hasn't finished building |
| Errors about a missing table or column | A migration wasn't applied: `npm run db:migrate:remote` |
| Live emails never arrive | Check the Email Routing activity log, then the Google routing rule (it can take up to an hour), then that the subject contains the code |
| Live email arrives but lands in the wrong lane | Expected for unknown senders: they get "ask for order number". Mention PO 4471 to show a lookup |
| Worker errors about CPU time | Very large HTML emails. Inbound mail is capped at 256 KB; lower `MAX_RAW_BYTES` in `worker/inbound.ts`, or move to Workers Paid ($5/month) |
