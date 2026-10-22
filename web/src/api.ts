import type { Facts, GroundingResult, Lane, LookupContext, ReadResult } from "../../core/types";

export type { Lane };

export interface Config {
  model: string;
  mode: "live" | "fixture";
  inboundAddress: string;
  turnstileSiteKey: string | null;
  retentionDays: number;
  liveCap: number;
  hintOrderRef: string;
}

export interface EmailSummary {
  id: string;
  seedNo: number | null;
  source: "seed" | "compose" | "live";
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  status: "new" | "processing" | "triaged" | "sent" | "archived" | "error";
  error?: string | null;
  lane: Lane | null;
  reason?: string | null;
  routeTo?: string | null;
  ruleId?: string | null;
  aiMode?: "live" | "cached" | "fixture" | null;
  category?: string | null;
  summary?: string | null;
  urgency?: string | null;
  language?: string | null;
  draftKind?: "reply" | "holding" | "suggested" | null;
  hasReviewerNote?: boolean;
  groundingOk?: boolean | null;
}

export interface AppState {
  sandbox: { code: string; createdAt: number } | null;
  emails: EmailSummary[];
  usage: { liveToday: number; liveCap: number; globalLeft: number } | null;
}

export interface AuditEntry {
  email_id?: string | null;
  actor: "ai" | "code" | "person" | "system";
  action: string;
  detail: string | null;
  at: number;
}

export interface EmailDetail {
  email: {
    id: string;
    seedNo: number | null;
    source: string;
    fromName: string;
    fromEmail: string;
    subject: string;
    body: string;
    attachments: string[];
    receivedAt: number;
    status: EmailSummary["status"];
    error: string | null;
  };
  triage: {
    read: ReadResult;
    context: LookupContext;
    facts: Facts;
    lane: Lane;
    ruleId: string;
    reason: string;
    routeTo: string | null;
    lang: string;
    aiMode: "live" | "cached" | "fixture";
    model: string | null;
    ms: number;
  } | null;
  draft: { kind: "reply" | "holding" | "suggested"; body: string; reviewerNote: string | null; grounding: GroundingResult; edited: boolean } | null;
  audit: AuditEntry[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(import.meta.env.BASE_URL + path.slice(1), {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((json as { error?: string }).error || `Request failed (${res.status})`, res.status);
  return json as T;
}

export const api = {
  config: () => call<Config>("GET", "/api/config"),
  state: () => call<AppState>("GET", "/api/state"),
  start: (turnstileToken: string | null) => call<{ ok: true; code: string }>("POST", "/api/start", { turnstileToken }),
  process: (id: string) => call<{ ok: boolean; error?: string; cap?: boolean }>("POST", `/api/process/${id}`),
  reset: () => call<{ ok: true }>("POST", "/api/reset"),
  email: (id: string) => call<EmailDetail>("GET", `/api/emails/${id}`),
  saveDraft: (id: string, body: string) => call<{ grounding: GroundingResult }>("PUT", `/api/emails/${id}/draft`, { body }),
  send: (id: string) => call<{ ok: true }>("POST", `/api/emails/${id}/send`),
  escalate: (id: string) => call<{ ok: true }>("POST", `/api/emails/${id}/escalate`),
  archive: (id: string) => call<{ ok: true }>("POST", `/api/emails/${id}/archive`),
  compose: (b: { fromName: string; fromEmail: string; subject: string; body: string; turnstileToken: string | null }) => call<{ id: string }>("POST", "/api/compose", b),
  system: () => call<SystemData>("GET", "/api/system"),
  admin: {
    overview: () => call<AdminOverview>("GET", "/admin/api/overview"),
    clearCache: () => call<{ deleted: number }>("POST", "/admin/api/cache/clear"),
    clearSandboxes: () => call<{ deleted: number }>("POST", "/admin/api/sandboxes/clear"),
  },
};

export interface SystemData {
  customers: { debtorId: string; name: string; domain: string; city: string; country: string }[];
  products: { sku: string; description: string; unit: string; returnable: boolean; notReturnableReason?: string }[];
  orders: import("../../core/types").Order[];
  shipments: import("../../core/types").Shipment[];
  policy: string;
  rmas: { rma_number: string; email_id: string; order_id: string; line_ids: string; created_at: number }[];
  outbox: { id: string; email_id: string; to_addr: string; subject: string; body: string; sent_at: number }[];
  audit: AuditEntry[];
}

export interface AdminOverview {
  model: string;
  modelKey: string;
  caps: { perSandbox: number; global: number };
  globalToday: number;
  counters: { key: string; day: string; count: number }[];
  sandboxes: { code: string; created_at: number; last_seen_at: number; emails: number; live: number; ai_today: number | null }[];
  cache: { seed_no: number; model_key: string; model: string | null; created_at: number; has_draft: number }[];
}

export const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: "ready", label: "Ready to send", hint: "Facts found, rule says safe, draft verified. One click." },
  { id: "needs_look", label: "Needs a look", hint: "Draft is there; something deserves a human glance." },
  { id: "escalated", label: "Escalated to a person", hint: "Rules say a person decides. Reason shown." },
  { id: "archived", label: "Archived", hint: "Spam, newsletters, auto-replies." },
];
