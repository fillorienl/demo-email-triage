import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { shortDate } from "../../../core/dates";
import type { GroundingResult } from "../../../core/types";
import { api, type EmailDetail } from "../api";
import { AiModeChip, CATEGORY_LABEL, Chip, clock, LaneBadge } from "../components/ui";
import { Link, navigate } from "../router";
import { useStore } from "../store";

const KIND_LABEL = { reply: "Draft reply", holding: "Holding reply", suggested: "Suggested reply for a colleague" };

export function Review({ id }: { id: string }) {
  const { state, refresh, processOne, busy, setNotice } = useStore();
  const [d, setD] = useState<EmailDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [grounding, setGrounding] = useState<GroundingResult | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.email(id);
      setD(r);
      setBody(r.draft?.body ?? "");
      setGrounding(r.draft?.grounding ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  // Reload when processing (here, from the board, or a live email's background run) changes this email.
  const summary = state?.emails.find((e) => e.id === id);
  const version = `${summary?.status}:${summary?.lane}`;
  useEffect(() => {
    load();
  }, [load, version]);

  if (error) return <p className="text-blocked">{error}</p>;
  if (!d) return <p className="text-muted">Loading…</p>;

  const { email, triage, draft } = d;
  const edited = draft ? body !== draft.body : false;
  const sent = email.status === "sent";

  async function act(label: string, fn: () => Promise<unknown>, after?: () => void) {
    setSaving(label);
    try {
      await fn();
      await refresh();
      after ? after() : await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const send = () =>
    act("send", async () => {
      if (edited) await api.saveDraft(id, body);
      await api.send(id);
    });

  const recheck = () =>
    act("check", async () => {
      const r = await api.saveDraft(id, body);
      setGrounding(r.grounding);
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/" className="text-sm text-muted hover:text-ink">
            ← Triage board
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{email.subject}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {triage && <LaneBadge lane={triage.lane} />}
          {sent && <Chip tone="ok">sent to mock outbox</Chip>}
          {triage && <AiModeChip mode={triage.aiMode} />}
        </div>
      </div>

      {!triage && (
        <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <span className="text-sm">{email.status === "error" ? `Processing failed: ${email.error}` : "This email hasn't been triaged yet."}</span>
          <button className="btn-primary" disabled={busy.has(id)} onClick={() => processOne(id).then(load)}>
            {busy.has(id) && <span className="spinner" />} Process this email
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* 1. Original email */}
        <Column title="Original email">
          <div className="space-y-1 text-[13px]">
            <div>
              <span className="text-muted">From </span>
              {email.fromName} <span className="text-muted">&lt;{email.fromEmail}&gt;</span>
            </div>
            <div className="text-muted">{clock(email.receivedAt)}</div>
          </div>
          <div className="mt-3 whitespace-pre-wrap rounded-md bg-paper p-3 text-sm leading-relaxed">
            <Highlighted text={email.body} terms={triage ? [...triage.read.order_refs, ...triage.read.invoice_refs, ...triage.read.products] : []} />
          </div>
          {email.attachments.length > 0 && <p className="mt-2 text-xs text-muted">Attachments (listed, not opened): {email.attachments.join(", ")}</p>}
          {triage && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">What the AI read</h3>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <Row k="Category">
                  {CATEGORY_LABEL[triage.read.category] ?? triage.read.category}
                  {triage.read.secondary_intents.length > 0 && <span className="text-muted"> + {triage.read.secondary_intents.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}</span>}
                </Row>
                <Row k="Detail">{triage.read.sub_reason}</Row>
                <Row k="Language">{triage.read.language.toUpperCase()}</Row>
                <Row k="Tone">
                  {triage.read.sentiment}, urgency {triage.read.urgency}
                </Row>
                <Row k="Confidence">{Math.round(triage.read.confidence * 100)}%</Row>
                {triage.read.contains_instructions_to_assistant && (
                  <Row k="Flag">
                    <span className="text-blocked">Contains instructions aimed at the AI</span>
                  </Row>
                )}
                {triage.read.threatens_to_leave_or_legal && (
                  <Row k="Flag">
                    <span className="text-blocked">Threatens to leave or take legal steps</span>
                  </Row>
                )}
              </dl>
            </div>
          )}
        </Column>

        {/* 2. Facts found by code */}
        <Column title="Facts found by code">
          {!triage ? (
            <p className="text-sm text-muted">Appears after processing.</p>
          ) : (
            <Facts d={d} />
          )}
        </Column>

        {/* 3. Draft */}
        <Column title={draft ? KIND_LABEL[draft.kind] : "Reply"}>
          {!triage ? (
            <p className="text-sm text-muted">Appears after processing.</p>
          ) : !draft ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">No draft for this email. {triage.lane === "escalated" ? `It goes to ${triage.routeTo ?? "a person"}.` : ""}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {draft.kind === "suggested" && <p className="text-xs text-review">A person decides on this one. The reply below is a suggestion they can use.</p>}
              {draft.kind === "holding" && <p className="text-xs text-muted">A short acknowledgement while {triage.routeTo ?? "a person"} takes over.</p>}
              <textarea
                className="field min-h-[320px] resize-y font-sans leading-relaxed"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sent}
                aria-label="Draft reply"
              />
              <GroundingBox g={grounding} stale={edited} onRecheck={recheck} checking={saving === "check"} />
            </div>
          )}
          {triage && (
            <div className="mt-4 flex flex-wrap gap-2">
              {draft && !sent && (
                <button className="btn-primary" disabled={!!saving} onClick={send}>
                  {saving === "send" && <span className="spinner" />}
                  {edited ? "Edit and send" : "Send"}
                </button>
              )}
              {!sent && triage.lane !== "escalated" && (
                <button className="btn-secondary" disabled={!!saving} onClick={() => act("escalate", () => api.escalate(id))}>
                  Escalate
                </button>
              )}
              {!sent && triage.lane !== "archived" && (
                <button className="btn-ghost" disabled={!!saving} onClick={() => act("archive", () => api.archive(id), () => navigate("/"))}>
                  Archive
                </button>
              )}
            </div>
          )}
          {sent && <p className="mt-3 text-xs text-muted">"Sent" means written to the mock outbox. This demo never emails anyone.</p>}
        </Column>
      </div>

      <section className="panel p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Audit trail</h2>
        <ol className="mt-3 space-y-1.5">
          {d.audit.map((a, i) => (
            <li key={i} className="grid grid-cols-[84px_64px_1fr] gap-3 text-[13px]">
              <span className="text-faint">{new Date(a.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className={a.actor === "ai" ? "text-carbon" : a.actor === "person" ? "text-ready" : "text-muted"}>{a.actor === "ai" ? "AI" : a.actor}</span>
              <span>
                {a.action}
                {a.detail && <span className="text-muted"> · {a.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        {triage && (
          <p className="mt-3 text-xs text-faint">
            {triage.model ? `Model: ${triage.model}. ` : ""}Processed in {(triage.ms / 1000).toFixed(1)} s.
          </p>
        )}
      </section>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
    if (!clean.length) return [text];
    const re = new RegExp(`(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return text.split(re);
  }, [text, terms]);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="ai-read" title="Read by the AI">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Facts({ d }: { d: EmailDetail }) {
  const t = d.triage!;
  const { customer, order, orderMatch, shipments, returnDecisions } = t.context;
  const matchText = { by_ref: "matched by the reference in the email", only_open_order: "the customer's only open order", several_open_orders: "several open orders", none: "" }[orderMatch];
  return (
    <div className="space-y-4 text-[13px]">
      <Block title="Customer">
        {customer ? (
          <>
            <div className="font-medium">{customer.name}</div>
            <div className="text-muted">
              {customer.debtorId} · {customer.city} · matched on @{customer.domain}
            </div>
          </>
        ) : (
          <div className="text-review">Sender not on file</div>
        )}
      </Block>

      <Block title="Order">
        {order ? (
          <>
            <div className="font-medium">
              {order.id} <span className="font-normal text-muted">· their ref {order.customerRef}</span>
            </div>
            <div className="text-muted">
              {matchText}. Ordered {shortDate(order.orderedOn)}, promised {shortDate(order.promisedOn)}
              {order.promisedOn < t.context.today && order.lines.some((l) => l.status === "backorder" || l.status === "open") && <span className="text-blocked"> (passed)</span>}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {order.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span>
                    {l.qty} × {l.description}
                  </span>
                  <span className="shrink-0 text-muted">
                    {l.status}
                    {l.expectedOn ? ` → ${shortDate(l.expectedOn)}` : l.deliveredOn ? ` ${shortDate(l.deliveredOn)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="text-muted">{orderMatch === "several_open_orders" ? "Several open orders, none named" : "No order found"}</div>
        )}
      </Block>

      {shipments.length > 0 && (
        <Block title="Shipment">
          {shipments.map((s) => (
            <div key={s.id}>
              {s.carrier}{" "}
              <a className="code text-carbon underline" href={s.trackingUrl} target="_blank" rel="noreferrer">
                {s.trackingCode}
              </a>
              <div className="text-muted">
                Shipped {shortDate(s.shippedOn)}, expected {shortDate(s.eta)}
              </div>
            </div>
          ))}
        </Block>
      )}

      {returnDecisions.length > 0 && (
        <Block title="Return policy (applied by code)">
          {returnDecisions.map((r) => (
            <div key={r.lineId} className={r.allowed ? "text-ready" : "text-blocked"}>
              {r.allowed ? "Allowed" : "Not allowed"}: {r.reason}
            </div>
          ))}
          {t.facts.rma_number && <div className="mt-1 text-muted">RMA {t.facts.rma_number} is created when you send.</div>}
        </Block>
      )}

      <Block title="Routing rule">
        <LaneBadge lane={t.lane} />
        <div className="mt-1">{t.reason}</div>
        <div className="code mt-0.5 text-faint">{t.ruleId}</div>
        {t.routeTo && <div className="mt-0.5 text-muted">Goes to: {t.routeTo}</div>}
      </Block>

      <details className="rounded-md bg-paper p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted">Facts handed to the AI ({Object.keys(t.facts).length})</summary>
        <dl className="mt-2 space-y-1">
          {Object.entries(t.facts).map(([k, v]) => (
            <div key={k}>
              <dt className="code text-faint">{k}</dt>
              <dd className="whitespace-pre-wrap break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted">{title}</h3>
      {children}
    </div>
  );
}

function GroundingBox({ g, stale, onRecheck, checking }: { g: GroundingResult | null; stale: boolean; onRecheck: () => void; checking: boolean }) {
  if (stale) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md bg-review-soft px-3 py-2 text-xs text-review">
        <span>Edited: check the facts again before sending.</span>
        <button className="underline" onClick={onRecheck} disabled={checking}>
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
    );
  }
  if (!g) return null;
  if (g.ok) {
    return (
      <div className="rounded-md bg-ready-soft px-3 py-2 text-xs text-ready">
        Grounding check passed: {g.checked} {g.checked === 1 ? "date, number or link" : "dates, numbers and links"} in this draft all appear in the facts or the customer's email.
      </div>
    );
  }
  return (
    <div className="rounded-md bg-blocked-soft px-3 py-2 text-xs text-blocked">
      <div className="font-medium">Not found in the facts:</div>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {g.issues.map((i, n) => (
          <li key={n}>
            <mark className="unverified code">{i.text}</mark> <span className="opacity-70">({i.kind.replace("_", " ")})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
