/** D1 access. Every per-visitor query is scoped by sandbox_id. */
import { todayIso } from "../core/dates";
import type { AiMode, EmailStatus, GroundingResult, Lane, Lang, ReadResult } from "../core/types";
import { SEED_EMAILS } from "../seed/emails";

export interface EmailRow {
  id: string;
  sandbox_id: string;
  seed_no: number | null;
  source: "seed" | "compose" | "live";
  from_name: string;
  from_email: string;
  subject: string;
  body: string;
  attachments: string;
  received_at: number;
  status: EmailStatus;
  error: string | null;
  updated_at: number;
}

export interface TriageRow {
  email_id: string;
  read_json: string;
  context_json: string;
  facts_json: string;
  lane: Lane;
  rule_id: string;
  reason: string;
  route_to: string | null;
  lang: Lang;
  ai_mode: AiMode;
  model: string | null;
  ms: number;
}

export interface DraftRow {
  email_id: string;
  kind: "reply" | "holding" | "suggested";
  body: string;
  grounding_json: string;
  edited: number;
}

export interface SandboxRow {
  id: string;
  code: string;
  rma_seq: number;
  created_at: number;
  last_seen_at: number;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomId(bytes = 12): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return "VEL-" + Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}

export async function getSandbox(db: D1Database, id: string | undefined): Promise<SandboxRow | null> {
  if (!id || !/^[0-9a-f]{32}$/.test(id)) return null;
  return db.prepare("SELECT * FROM sandboxes WHERE id = ?").bind(id).first<SandboxRow>();
}

export async function sandboxByCode(db: D1Database, code: string): Promise<SandboxRow | null> {
  return db.prepare("SELECT * FROM sandboxes WHERE code = ?").bind(code.toUpperCase()).first<SandboxRow>();
}

export async function touchSandbox(db: D1Database, id: string) {
  await db.prepare("UPDATE sandboxes SET last_seen_at = ? WHERE id = ?").bind(Date.now(), id).run();
}

function seedStatements(db: D1Database, sandboxId: string, now: number): D1PreparedStatement[] {
  const insert = db.prepare(
    "INSERT INTO emails (id, sandbox_id, seed_no, source, from_name, from_email, subject, body, attachments, received_at, status, updated_at) VALUES (?, ?, ?, 'seed', ?, ?, ?, ?, ?, ?, 'new', ?)",
  );
  return SEED_EMAILS.map((e) =>
    insert.bind(randomId(), sandboxId, e.no, e.fromName, e.fromEmail, e.subject, e.body, JSON.stringify(e.attachments ?? []), now - e.minutesAgo * 60_000, now),
  );
}

export async function createSandbox(db: D1Database): Promise<SandboxRow> {
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const sb: SandboxRow = { id: randomId(16), code: randomCode(), rma_seq: 0, created_at: now, last_seen_at: now };
    try {
      await db.batch([
        db.prepare("INSERT INTO sandboxes (id, code, rma_seq, created_at, last_seen_at) VALUES (?, ?, 0, ?, ?)").bind(sb.id, sb.code, now, now),
        ...seedStatements(db, sb.id, now),
        audit(db, sb.id, null, "system", "Sandbox created", `Code ${sb.code}, ${SEED_EMAILS.length} seed emails`),
      ]);
      await bump(db, "sandboxes_created");
      return sb;
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }
  throw new Error("Could not create a sandbox code, try again.");
}

/** Wipes everything the visitor did and puts the 11 seed emails back. Keeps the id and code. */
export async function resetSandbox(db: D1Database, sandboxId: string) {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM emails WHERE sandbox_id = ?").bind(sandboxId),
    db.prepare("DELETE FROM outbox WHERE sandbox_id = ?").bind(sandboxId),
    db.prepare("DELETE FROM rmas WHERE sandbox_id = ?").bind(sandboxId),
    db.prepare("DELETE FROM audit_log WHERE sandbox_id = ?").bind(sandboxId),
    db.prepare("UPDATE sandboxes SET rma_seq = 0 WHERE id = ?").bind(sandboxId),
    ...seedStatements(db, sandboxId, now),
    audit(db, sandboxId, null, "person", "Reset demo", "Seed emails restored"),
  ]);
}

export function audit(db: D1Database, sandboxId: string, emailId: string | null, actor: "ai" | "code" | "person" | "system", action: string, detail?: string) {
  return db
    .prepare("INSERT INTO audit_log (sandbox_id, email_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sandboxId, emailId, actor, action, detail ?? null, Date.now());
}

export async function insertEmail(
  db: D1Database,
  sandboxId: string,
  e: { source: "compose" | "live"; fromName: string; fromEmail: string; subject: string; body: string; attachments: string[] },
): Promise<string> {
  const id = randomId();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO emails (id, sandbox_id, seed_no, source, from_name, from_email, subject, body, attachments, received_at, status, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'new', ?)",
      )
      .bind(id, sandboxId, e.source, e.fromName, e.fromEmail, e.subject, e.body, JSON.stringify(e.attachments), now, now),
    audit(db, sandboxId, id, "system", e.source === "live" ? "Live email received" : "Test email composed", `From ${e.fromEmail}`),
  ]);
  return id;
}

export async function getEmail(db: D1Database, sandboxId: string, id: string) {
  return db.prepare("SELECT * FROM emails WHERE id = ? AND sandbox_id = ?").bind(id, sandboxId).first<EmailRow>();
}

/** Claims an email for processing. Returns null if another request already has it. */
export async function claimEmail(db: D1Database, sandboxId: string, id: string): Promise<EmailRow | null> {
  const now = Date.now();
  return db
    .prepare(
      "UPDATE emails SET status = 'processing', error = NULL, updated_at = ? WHERE id = ? AND sandbox_id = ? AND (status IN ('new', 'error') OR (status = 'processing' AND updated_at < ?)) RETURNING *",
    )
    .bind(now, id, sandboxId, now - 120_000)
    .first<EmailRow>();
}

export async function failEmail(db: D1Database, sandboxId: string, id: string, message: string) {
  await db.batch([
    db.prepare("UPDATE emails SET status = 'error', error = ?, updated_at = ? WHERE id = ? AND sandbox_id = ?").bind(message.slice(0, 500), Date.now(), id, sandboxId),
    audit(db, sandboxId, id, "system", "Processing failed", message.slice(0, 300)),
  ]);
}

export async function saveTriage(
  db: D1Database,
  sandboxId: string,
  emailId: string,
  t: {
    read: ReadResult;
    context: unknown;
    facts: Record<string, string>;
    lane: Lane;
    ruleId: string;
    reason: string;
    routeTo: string | null;
    lang: Lang;
    aiMode: AiMode;
    model: string | null;
    ms: number;
  },
  draft: { kind: DraftRow["kind"]; body: string; grounding: GroundingResult } | null,
  auditLines: { actor: "ai" | "code"; action: string; detail?: string }[],
) {
  const now = Date.now();
  const status: EmailStatus = t.lane === "archived" ? "archived" : "triaged";
  await db.batch([
    db
      .prepare(
        `INSERT OR REPLACE INTO triage_results (email_id, sandbox_id, read_json, context_json, facts_json, lane, rule_id, reason, route_to, lang, ai_mode, model, ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(emailId, sandboxId, JSON.stringify(t.read), JSON.stringify(t.context), JSON.stringify(t.facts), t.lane, t.ruleId, t.reason, t.routeTo, t.lang, t.aiMode, t.model, t.ms, now),
    draft
      ? db
          .prepare("INSERT OR REPLACE INTO drafts (email_id, sandbox_id, kind, body, grounding_json, edited, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
          .bind(emailId, sandboxId, draft.kind, draft.body, JSON.stringify(draft.grounding), now)
      : db.prepare("DELETE FROM drafts WHERE email_id = ? AND sandbox_id = ?").bind(emailId, sandboxId),
    db.prepare("UPDATE emails SET status = ?, error = NULL, updated_at = ? WHERE id = ? AND sandbox_id = ?").bind(status, now, emailId, sandboxId),
    ...auditLines.map((a) => audit(db, sandboxId, emailId, a.actor, a.action, a.detail)),
  ]);
}

export async function nextRmaNumber(db: D1Database, sandboxId: string): Promise<string> {
  const row = await db.prepare("UPDATE sandboxes SET rma_seq = rma_seq + 1 WHERE id = ? RETURNING rma_seq").bind(sandboxId).first<{ rma_seq: number }>();
  return `RMA-26-${String(400 + (row?.rma_seq ?? 1)).padStart(4, "0")}`;
}

// ---------- usage counters and caps ----------

export async function bump(db: D1Database, key: string, by = 1) {
  await db
    .prepare("INSERT INTO usage_counters (key, day, count) VALUES (?, ?, ?) ON CONFLICT (key, day) DO UPDATE SET count = count + excluded.count")
    .bind(key, todayIso(), by)
    .run();
}

export async function counter(db: D1Database, key: string): Promise<number> {
  const row = await db.prepare("SELECT count FROM usage_counters WHERE key = ? AND day = ?").bind(key, todayIso()).first<{ count: number }>();
  return row?.count ?? 0;
}

// ---------- seed AI cache ----------

export async function getSeedCache(db: D1Database, seedNo: number, modelKey: string) {
  return db
    .prepare("SELECT read_json, draft_template, model FROM seed_ai_cache WHERE seed_no = ? AND model_key = ?")
    .bind(seedNo, modelKey)
    .first<{ read_json: string; draft_template: string | null; model: string | null }>();
}

export async function putSeedCache(db: D1Database, seedNo: number, modelKey: string, read: ReadResult, draftTemplate: string | null, model: string | null) {
  await db
    .prepare("INSERT OR REPLACE INTO seed_ai_cache (seed_no, model_key, read_json, draft_template, model, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(seedNo, modelKey, JSON.stringify(read), draftTemplate, model, Date.now())
    .run();
}
