import { useEffect, useState } from "react";
import { LANES, type EmailSummary, type Lane } from "../api";
import { AiModeChip, CATEGORY_LABEL, Chip, LANE_STYLE, SectionTitle, timeAgo } from "../components/ui";
import { Link } from "../router";
import { useStore } from "../store";

const MINUTES_KEY = "triage.minutesPerEmail";

function readMinutes(): number {
  try {
    const v = Number(localStorage.getItem(MINUTES_KEY));
    return v > 0 && v < 120 ? v : 4;
  } catch {
    return 4;
  }
}

export function Board() {
  const { state, busy, running, processInbox, processOne, config } = useStore();
  const [minutes, setMinutes] = useState(readMinutes);
  useEffect(() => {
    try {
      localStorage.setItem(MINUTES_KEY, String(minutes));
    } catch {
      /* private mode: the default is fine */
    }
  }, [minutes]);

  if (!state) return <p className="text-muted">Loading the inbox…</p>;

  const emails = state.emails;
  const inbox = emails.filter((e) => !e.lane);
  const byLane = (l: Lane) => emails.filter((e) => e.lane === l);
  const done = emails.length - inbox.length;
  const noTyping = byLane("ready").length + byLane("archived").length;
  const pending = inbox.filter((e) => e.status === "new" || e.status === "error").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service inbox</h1>
          <p className="mt-1 text-sm text-muted">
            Veldhuis's service@ inbox on a Monday morning. AI reads and drafts, code checks every fact, a person sends.
          </p>
        </div>
        <button className="btn-primary" disabled={running || (!!state.sandbox && pending === 0)} onClick={processInbox}>
          {running ? <span className="spinner" /> : null}
          {running ? "Processing…" : state.sandbox ? `Process inbox${pending ? ` (${pending})` : ""}` : "Process inbox"}
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {LANES.map((l) => (
          <div key={l.id} className="panel p-4">
            <div className={`text-xs font-medium ${LANE_STYLE[l.id].text}`}>{l.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{byLane(l.id).length}</div>
          </div>
        ))}
        <div className="panel p-4">
          <div className="text-xs font-medium text-muted">Need no typing</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {noTyping} <span className="text-base font-normal text-muted">of {done || emails.length}</span>
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-xs font-medium text-muted">Time saved (estimate)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">≈ {noTyping * minutes} min</div>
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
            {noTyping} emails ×
            <input
              type="number"
              min={1}
              max={60}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="w-11 rounded border border-line px-1 py-0.5 text-[11px] text-ink"
              aria-label="Minutes per email"
            />
            min each
          </label>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <section>
          <SectionTitle right={<span className="text-xs text-muted">{inbox.length} unread</span>}>Inbox</SectionTitle>
          <div className="panel divide-y divide-line overflow-hidden">
            {inbox.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted">
                Inbox is empty.{" "}
                {state.sandbox && config && (
                  <>
                    Email <span className="text-ink">{config.inboundAddress}</span> with <span className="code text-carbon">{state.sandbox.code}</span> in the subject, or{" "}
                    <Link href="/compose" className="text-carbon underline">
                      compose one
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
            {inbox.map((e) => (
              <InboxRow key={e.id} e={e} busy={busy.has(e.id) || e.status === "processing"} onRetry={() => processOne(e.id)} />
            ))}
          </div>
          {!state.sandbox && (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Clicking Process inbox gives you your own sandbox. Nothing you do here is visible to anyone else, and replies are never actually emailed.
            </p>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {LANES.map((l) => (
            <div key={l.id}>
              <SectionTitle right={<span className="text-xs tabular-nums text-muted">{byLane(l.id).length}</span>}>
                <span className={LANE_STYLE[l.id].text}>{l.label}</span>
              </SectionTitle>
              <p className="-mt-2 mb-2 text-xs text-faint">{l.hint}</p>
              <div className="space-y-2">
                {byLane(l.id).length === 0 && <div className="rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-xs text-faint">Nothing here yet</div>}
                {byLane(l.id).map((e) => (
                  <LaneCard key={e.id} e={e} />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function InboxRow({ e, busy, onRetry }: { e: EmailSummary; busy: boolean; onRetry: () => void }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{e.fromName}</span>
        <span className="shrink-0 text-[11px] text-faint">{timeAgo(e.receivedAt)}</span>
      </div>
      <div className="truncate text-sm">{e.subject}</div>
      <div className="mt-0.5 line-clamp-2 text-xs text-muted">{e.snippet}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {e.source === "live" && <Chip tone="carbon">live email</Chip>}
        {e.source === "compose" && <Chip>typed in app</Chip>}
        {busy && (
          <span className="inline-flex items-center gap-1.5 text-xs text-carbon">
            <span className="spinner" /> AI reading…
          </span>
        )}
        {!busy && e.status === "error" && (
          <>
            <Chip tone="bad" title={e.error ?? ""}>
              failed
            </Chip>
            <span className="line-clamp-2 text-[11px] text-blocked">{e.error}</span>
            <button className="text-xs text-carbon underline" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LaneCard({ e }: { e: EmailSummary }) {
  return (
    <Link href={`/email/${e.id}`} className="land panel block px-4 py-3 transition-colors hover:border-faint">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{e.subject}</span>
        {e.status === "sent" && <Chip tone="ok">sent</Chip>}
      </div>
      <div className="truncate text-xs text-muted">{e.fromName}</div>
      {e.summary && <div className="mt-1 line-clamp-2 text-[13px]">{e.summary}</div>}
      {e.reason && <div className={`mt-1 text-xs ${e.lane ? LANE_STYLE[e.lane].text : ""}`}>{e.reason}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.category && <Chip>{CATEGORY_LABEL[e.category] ?? e.category}</Chip>}
        {e.language && <Chip>{e.language.toUpperCase()}</Chip>}
        {e.urgency === "high" && <Chip tone="bad">urgent</Chip>}
        {e.routeTo && <Chip>→ {e.routeTo}</Chip>}
        {e.draftKind && (e.groundingOk ? <Chip tone="ok">facts verified</Chip> : <Chip tone="warn">check draft</Chip>)}
        {e.source === "live" && <Chip tone="carbon">live email</Chip>}
        <AiModeChip mode={e.aiMode} />
      </div>
    </Link>
  );
}
