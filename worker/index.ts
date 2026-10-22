import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { checkGrounding } from "../core/grounding";
import { todayIso } from "../core/dates";
import { SEED_EMAILS } from "../seed/emails";
import { buildOrders, CUSTOMERS, PRODUCTS, RETURN_POLICY } from "../seed/reference";
import { modelKey, modelLabel } from "./ai/providers";
import type { Env } from "./env";
import { isAdmin, verifyTurnstile } from "./guards";
import { handleInbound } from "./inbound";
import { processEmail } from "./process";
import {
  audit,
  counter,
  createSandbox,
  getEmail,
  getSandbox,
  insertEmail,
  resetSandbox,
  touchSandbox,
  type DraftRow,
  type EmailRow,
  type SandboxRow,
  type TriageRow,
} from "./store";

type App = { Bindings: Env; Variables: { sandbox: SandboxRow } };

/** Path the demo is served under (demos.fillorie.nl/email-triage); matches `base` in vite.config.ts. */
const BASE = "/email-triage";
const app = new Hono<App>().basePath(BASE);

const COOKIE = "triage_sandbox";

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Something went wrong" }, 500);
});

// ---------- public config ----------

app.get("/api/config", async (c) => {
  return c.json({
    model: modelLabel(c.env),
    mode: c.env.AI_MODE === "fixture" ? "fixture" : "live",
    inboundAddress: c.env.INBOUND_ADDRESS,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    retentionDays: Number(c.env.RETENTION_DAYS),
    liveCap: Number(c.env.CAP_SANDBOX_LIVE_PER_DAY),
    hintOrderRef: "PO 4471",
  });
});

// ---------- sandbox ----------

async function currentSandbox(c: Context<App>) {
  return getSandbox(c.env.DB, getCookie(c, COOKIE));
}

const needSandbox = async (c: Context<App>, next: () => Promise<void>) => {
  const sb = await currentSandbox(c);
  if (!sb) return c.json({ error: "No demo sandbox yet. Start the demo first." }, 401);
  c.set("sandbox", sb);
  await next();
};

app.post("/api/start", async (c) => {
  const existing = await currentSandbox(c);
  if (existing) return c.json({ ok: true, code: existing.code });
  const body = await c.req.json<{ turnstileToken?: string }>().catch(() => ({}) as { turnstileToken?: string });
  if (!(await verifyTurnstile(c.env, body.turnstileToken, c.req.header("CF-Connecting-IP") ?? null))) {
    return c.json({ error: "The bot check failed. Reload the page and try again." }, 403);
  }
  const sb = await createSandbox(c.env.DB);
  setCookie(c, COOKIE, sb.id, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: BASE,
    maxAge: Number(c.env.RETENTION_DAYS) * 86_400,
  });
  return c.json({ ok: true, code: sb.code });
});

type SummaryRow = EmailRow & Partial<Pick<TriageRow, "lane" | "reason" | "route_to" | "rule_id" | "ai_mode" | "read_json">> & { draft_kind: string | null; reviewer_note: string | null; grounding_json: string | null };

function summary(r: SummaryRow) {
  const read = r.read_json ? JSON.parse(r.read_json) : null;
  const grounding = r.grounding_json ? JSON.parse(r.grounding_json) : null;
  return {
    id: r.id,
    seedNo: r.seed_no,
    source: r.source,
    fromName: r.from_name,
    fromEmail: r.from_email,
    subject: r.subject,
    snippet: r.body.replace(/\s+/g, " ").slice(0, 140),
    receivedAt: r.received_at,
    status: r.status,
    error: r.error,
    lane: r.lane ?? null,
    reason: r.reason ?? null,
    routeTo: r.route_to ?? null,
    ruleId: r.rule_id ?? null,
    aiMode: r.ai_mode ?? null,
    category: read?.category ?? null,
    summary: read?.summary ?? null,
    urgency: read?.urgency ?? null,
    language: read?.language ?? null,
    draftKind: r.draft_kind,
    hasReviewerNote: !!r.reviewer_note,
    groundingOk: grounding ? grounding.ok : null,
  };
}

app.get("/api/state", async (c) => {
  const sb = await currentSandbox(c);
  if (!sb) {
    const now = Date.now();
    return c.json({
      sandbox: null,
      emails: SEED_EMAILS.map((e) => ({
        id: `preview-${e.no}`,
        seedNo: e.no,
        source: "seed",
        fromName: e.fromName,
        fromEmail: e.fromEmail,
        subject: e.subject,
        snippet: e.body.replace(/\s+/g, " ").slice(0, 140),
        receivedAt: now - e.minutesAgo * 60_000,
        status: "new",
        lane: null,
      })),
      usage: null,
    });
  }
  c.executionCtx.waitUntil(touchSandbox(c.env.DB, sb.id));
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, t.lane, t.reason, t.route_to, t.rule_id, t.ai_mode, t.read_json, d.kind AS draft_kind, d.reviewer_note, d.grounding_json
       FROM emails e
       LEFT JOIN triage_results t ON t.email_id = e.id
       LEFT JOIN drafts d ON d.email_id = e.id
      WHERE e.sandbox_id = ?
      ORDER BY e.received_at DESC`,
  )
    .bind(sb.id)
    .all<SummaryRow>();
  return c.json({
    sandbox: { code: sb.code, createdAt: sb.created_at },
    emails: results.map(summary),
    usage: {
      liveToday: await counter(c.env.DB, `sandbox_live:${sb.id}`),
      liveCap: Number(c.env.CAP_SANDBOX_LIVE_PER_DAY),
      globalLeft: Math.max(0, Number(c.env.CAP_GLOBAL_AI_CALLS_PER_DAY) - (await counter(c.env.DB, "global_ai_calls"))),
    },
  });
});

app.post("/api/process/:id", needSandbox, async (c) => {
  const result = await processEmail(c.env, c.get("sandbox").id, c.req.param("id")!);
  return c.json(result, result.ok ? 200 : result.cap ? 429 : 502);
});

app.post("/api/reset", needSandbox, async (c) => {
  await resetSandbox(c.env.DB, c.get("sandbox").id);
  return c.json({ ok: true });
});

app.post("/api/compose", needSandbox, async (c) => {
  const b = await c.req.json<{ fromName?: string; fromEmail?: string; subject?: string; body?: string; turnstileToken?: string }>();
  if (!(await verifyTurnstile(c.env, b.turnstileToken, c.req.header("CF-Connecting-IP") ?? null))) {
    return c.json({ error: "The bot check failed. Try again." }, 403);
  }
  const fromEmail = (b.fromEmail ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(fromEmail)) return c.json({ error: "Enter a valid sender address." }, 400);
  const body = (b.body ?? "").trim();
  if (body.length < 5) return c.json({ error: "Write a message first." }, 400);
  if (body.length > 4000) return c.json({ error: "Keep the message under 4,000 characters." }, 400);
  const id = await insertEmail(c.env.DB, c.get("sandbox").id, {
    source: "compose",
    fromName: (b.fromName ?? "").trim().slice(0, 80) || fromEmail,
    fromEmail,
    subject: (b.subject ?? "").trim().slice(0, 200) || "(no subject)",
    body,
    attachments: [],
  });
  return c.json({ id });
});

// ---------- one email ----------

app.get("/api/emails/:id", needSandbox, async (c) => {
  const sb = c.get("sandbox");
  const id = c.req.param("id")!;
  const email = await getEmail(c.env.DB, sb.id, id);
  if (!email) return c.json({ error: "Email not found" }, 404);
  const [triage, draft, auditRows] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM triage_results WHERE email_id = ? AND sandbox_id = ?").bind(id, sb.id).first<TriageRow>(),
    c.env.DB.prepare("SELECT * FROM drafts WHERE email_id = ? AND sandbox_id = ?").bind(id, sb.id).first<DraftRow>(),
    c.env.DB.prepare("SELECT actor, action, detail, at FROM audit_log WHERE sandbox_id = ? AND email_id = ? ORDER BY id").bind(sb.id, id).all(),
  ]);
  return c.json({
    email: {
      id: email.id,
      seedNo: email.seed_no,
      source: email.source,
      fromName: email.from_name,
      fromEmail: email.from_email,
      subject: email.subject,
      body: email.body,
      attachments: JSON.parse(email.attachments),
      receivedAt: email.received_at,
      status: email.status,
      error: email.error,
    },
    triage: triage && {
      read: JSON.parse(triage.read_json),
      context: JSON.parse(triage.context_json),
      facts: JSON.parse(triage.facts_json),
      lane: triage.lane,
      ruleId: triage.rule_id,
      reason: triage.reason,
      routeTo: triage.route_to,
      lang: triage.lang,
      aiMode: triage.ai_mode,
      model: triage.model,
      ms: triage.ms,
    },
    draft: draft && { kind: draft.kind, body: draft.body, reviewerNote: draft.reviewer_note, grounding: JSON.parse(draft.grounding_json), edited: !!draft.edited },
    audit: auditRows.results,
  });
});

async function loadForAction(c: Context<App>) {
  const sb = c.get("sandbox");
  const id = c.req.param("id")!;
  const email = await getEmail(c.env.DB, sb.id, id);
  const triage = email && (await c.env.DB.prepare("SELECT * FROM triage_results WHERE email_id = ? AND sandbox_id = ?").bind(id, sb.id).first<TriageRow>());
  return { sb, id, email, triage };
}

app.put("/api/emails/:id/draft", needSandbox, async (c) => {
  const { sb, id, email, triage } = await loadForAction(c);
  if (!email || !triage) return c.json({ error: "Email not triaged yet" }, 404);
  const { body } = await c.req.json<{ body: string }>();
  const grounding = checkGrounding(body, JSON.parse(triage.facts_json), `${email.subject}\n${email.body}`);
  await c.env.DB.prepare("UPDATE drafts SET body = ?, grounding_json = ?, edited = 1, updated_at = ? WHERE email_id = ? AND sandbox_id = ?")
    .bind(body.slice(0, 6000), JSON.stringify(grounding), Date.now(), id, sb.id)
    .run();
  return c.json({ grounding });
});

/** "Send" never emails anyone: it writes to the mock outbox, and creates the RMA for an approved return. */
app.post("/api/emails/:id/send", needSandbox, async (c) => {
  const { sb, id, email, triage } = await loadForAction(c);
  if (!email || !triage) return c.json({ error: "Email not triaged yet" }, 404);
  if (email.status === "sent") return c.json({ error: "Already sent" }, 409);
  const draft = await c.env.DB.prepare("SELECT * FROM drafts WHERE email_id = ? AND sandbox_id = ?").bind(id, sb.id).first<DraftRow>();
  if (!draft) return c.json({ error: "There is no draft to send" }, 400);

  const facts = JSON.parse(triage.facts_json) as Record<string, string>;
  const ctx = JSON.parse(triage.context_json) as { order: { id: string } | null; returnDecisions: { lineId: string; allowed: boolean }[] };
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare("INSERT INTO outbox (id, sandbox_id, email_id, to_addr, subject, body, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
      crypto.randomUUID(),
      sb.id,
      id,
      email.from_email,
      email.subject.match(/^(re|aw|antw):/i) ? email.subject : `Re: ${email.subject}`,
      draft.body,
      now,
    ),
    c.env.DB.prepare("UPDATE emails SET status = 'sent', updated_at = ? WHERE id = ? AND sandbox_id = ?").bind(now, id, sb.id),
    audit(c.env.DB, sb.id, id, "person", draft.edited ? "Edited and sent reply" : "Sent reply", `To ${email.from_email} (mock outbox, nothing emailed)`),
  ];
  if (facts.rma_number && ctx.order && facts.return_decision === "approved") {
    const lines = ctx.returnDecisions.filter((d) => d.allowed).map((d) => d.lineId);
    stmts.push(
      c.env.DB.prepare("INSERT OR IGNORE INTO rmas (sandbox_id, rma_number, email_id, order_id, line_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
        sb.id,
        facts.rma_number,
        id,
        ctx.order.id,
        JSON.stringify(lines),
        now,
      ),
      audit(c.env.DB, sb.id, id, "code", "RMA created", `${facts.rma_number} for ${ctx.order.id}`),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.post("/api/emails/:id/escalate", needSandbox, async (c) => {
  const { sb, id, email, triage } = await loadForAction(c);
  if (!email || !triage) return c.json({ error: "Email not triaged yet" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE triage_results SET lane = 'escalated', rule_id = 'manual', reason = 'Escalated by a person', route_to = COALESCE(route_to, 'Service lead') WHERE email_id = ? AND sandbox_id = ?").bind(id, sb.id),
    c.env.DB.prepare("UPDATE emails SET status = 'triaged', updated_at = ? WHERE id = ? AND sandbox_id = ?").bind(Date.now(), id, sb.id),
    audit(c.env.DB, sb.id, id, "person", "Escalated", `Was: ${triage.lane}`),
  ]);
  return c.json({ ok: true });
});

app.post("/api/emails/:id/archive", needSandbox, async (c) => {
  const { sb, id, email, triage } = await loadForAction(c);
  if (!email || !triage) return c.json({ error: "Email not triaged yet" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE triage_results SET lane = 'archived', rule_id = 'manual', reason = 'Archived by a person' WHERE email_id = ? AND sandbox_id = ?").bind(id, sb.id),
    c.env.DB.prepare("UPDATE emails SET status = 'archived', updated_at = ? WHERE id = ? AND sandbox_id = ?").bind(Date.now(), id, sb.id),
    audit(c.env.DB, sb.id, id, "person", "Archived", `Was: ${triage.lane}`),
  ]);
  return c.json({ ok: true });
});

// ---------- mock order system, outbox, audit ----------

app.get("/api/system", async (c) => {
  const sb = await currentSandbox(c);
  const { orders, shipments } = buildOrders(todayIso());
  const base = { customers: CUSTOMERS, products: PRODUCTS, orders, shipments, policy: RETURN_POLICY.text };
  if (!sb) return c.json({ ...base, rmas: [], outbox: [], audit: [] });
  const [rmas, outbox, auditRows] = await Promise.all([
    c.env.DB.prepare("SELECT rma_number, email_id, order_id, line_ids, created_at FROM rmas WHERE sandbox_id = ? ORDER BY created_at DESC").bind(sb.id).all(),
    c.env.DB.prepare("SELECT id, email_id, to_addr, subject, body, sent_at FROM outbox WHERE sandbox_id = ? ORDER BY sent_at DESC").bind(sb.id).all(),
    c.env.DB.prepare("SELECT email_id, actor, action, detail, at FROM audit_log WHERE sandbox_id = ? ORDER BY id DESC LIMIT 300").bind(sb.id).all(),
  ]);
  return c.json({ ...base, rmas: rmas.results, outbox: outbox.results, audit: auditRows.results });
});

// ---------- admin (behind Cloudflare Access) ----------

const admin = new Hono<App>();
admin.use("*", async (c, next) => {
  if (!(await isAdmin(c.env, c.req.raw))) return c.json({ error: "Admin only" }, 403);
  await next();
});

admin.get("/overview", async (c) => {
  const db = c.env.DB;
  const counters = await db.prepare("SELECT key, day, count FROM usage_counters WHERE key NOT LIKE 'sandbox_live:%' ORDER BY day DESC, key LIMIT 120").all();
  const sandboxes = await db
    .prepare(
      `SELECT s.code, s.created_at, s.last_seen_at,
              (SELECT COUNT(*) FROM emails e WHERE e.sandbox_id = s.id) AS emails,
              (SELECT COUNT(*) FROM emails e WHERE e.sandbox_id = s.id AND e.source = 'live') AS live,
              (SELECT count FROM usage_counters u WHERE u.key = 'sandbox_live:' || s.id AND u.day = ?) AS ai_today
         FROM sandboxes s ORDER BY s.last_seen_at DESC LIMIT 100`,
    )
    .bind(todayIso())
    .all();
  const cache = await db.prepare("SELECT seed_no, model_key, model, created_at, draft_template IS NOT NULL AS has_draft FROM seed_ai_cache ORDER BY model_key, seed_no").all();
  return c.json({
    model: modelLabel(c.env),
    modelKey: modelKey(c.env),
    caps: { perSandbox: Number(c.env.CAP_SANDBOX_LIVE_PER_DAY), global: Number(c.env.CAP_GLOBAL_AI_CALLS_PER_DAY) },
    globalToday: await counter(db, "global_ai_calls"),
    counters: counters.results,
    sandboxes: sandboxes.results,
    cache: cache.results,
  });
});

/** Clears the seed cache for the current model; the next run of each seed email uses live AI and refills it. */
admin.post("/cache/clear", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM seed_ai_cache WHERE model_key = ?").bind(modelKey(c.env)).run();
  return c.json({ deleted: r.meta.changes });
});

admin.post("/sandboxes/clear", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM sandboxes").run();
  return c.json({ deleted: r.meta.changes });
});

app.route("/admin/api", admin);

// ---------- static app ----------

// Unknown API paths stay JSON 404s instead of falling through to the SPA.
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("/admin/api/*", (c) => c.json({ error: "Not found" }, 404));

// The build puts assets at the root of dist/client, so drop BASE before asking ASSETS.
// The Vite dev server already serves them under BASE, so dev passes the path through.
app.all("*", (c) => {
  if (import.meta.env.DEV) return c.env.ASSETS.fetch(c.req.raw);
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice(BASE.length) || "/";
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

// ---------- cleanup ----------

async function cleanup(env: Env) {
  const cutoff = Date.now() - Number(env.RETENTION_DAYS) * 86_400_000;
  const r = await env.DB.prepare("DELETE FROM sandboxes WHERE created_at < ?").bind(cutoff).run();
  const oldDay = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM usage_counters WHERE day < ?").bind(oldDay).run();
  console.log(`cleanup: removed ${r.meta.changes} sandboxes older than ${env.RETENTION_DAYS} days`);
}

export default {
  fetch: app.fetch,
  email: handleInbound,
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
