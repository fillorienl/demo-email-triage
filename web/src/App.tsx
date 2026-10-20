import { useState } from "react";
import { api } from "./api";
import { Link, usePath } from "./router";
import { Admin } from "./screens/Admin";
import { Board } from "./screens/Board";
import { Compose } from "./screens/Compose";
import { Queue } from "./screens/Queue";
import { Review } from "./screens/Review";
import { SystemScreen } from "./screens/System";
import { useStore } from "./store";

export function App() {
  const path = usePath();
  const { state, config, notice, setNotice } = useStore();
  const escalated = state?.emails.filter((e) => e.lane === "escalated" && e.status !== "sent").length ?? 0;
  const unread = state?.emails.filter((e) => !e.lane).length ?? 0;

  let screen = <Board />;
  if (path.startsWith("/email/")) screen = <Review id={path.slice(7)} />;
  else if (path === "/queue") screen = <Queue />;
  else if (path === "/system") screen = <SystemScreen />;
  else if (path === "/compose") screen = <Compose />;
  else if (path === "/admin") screen = <Admin />;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col bg-ink text-white lg:sticky lg:top-0 lg:h-screen lg:w-[248px]">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Mark />
          <Link href="/" className="leading-tight">
            <span className="block text-[15px] font-semibold">Email triage</span>
            <span className="block text-xs text-white/55">Veldhuis Industrial Supply</span>
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col">
          <NavLink href="/" label="Triage board" count={unread} active={path === "/"} />
          <NavLink href="/queue" label="Person queue" count={escalated} active={path === "/queue"} />
          <NavLink href="/system" label="Orders & outbox" active={path === "/system"} />
          <NavLink href="/compose" label="Compose test email" active={path === "/compose"} />
        </nav>
        <div className="mt-auto hidden space-y-4 border-t border-white/10 px-5 py-5 lg:block">
          <LiveEmailCard />
          <div>
            <div className="text-xs text-white/50">Emails read by</div>
            <div className="mt-0.5 break-words text-[13px] text-white/90">{config?.model ?? "…"}</div>
          </div>
          <ResetButton />
          <Privacy />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {config?.mode === "fixture" && (
          <div className="bg-review-soft px-6 py-2 text-[13px] text-review">Offline test mode: AI results come from prepared test data. Set AI_MODE=live before a demo.</div>
        )}
        {notice && (
          <div role="status" className="flex items-start justify-between gap-4 bg-blocked-soft px-6 py-2 text-[13px] text-blocked">
            <span>{notice}</span>
            <button className="shrink-0 underline" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="border-b border-line bg-white px-4 py-3 lg:hidden">
          <LiveEmailCard compact />
        </div>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">{screen}</main>
        <div className="space-y-3 border-t border-line px-4 py-4 text-xs text-muted sm:px-8 lg:hidden">
          <div>Read by {config?.model ?? "…"}</div>
          <ResetButton light />
          <Privacy light />
        </div>
      </div>
    </div>
  );
}

function NavLink({ href, label, count, active }: { href: string; label: string; count?: number; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${active ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white"}`}
    >
      <span>{label}</span>
      {!!count && <span className="rounded-full bg-white/15 px-2 text-xs tabular-nums">{count}</span>}
    </Link>
  );
}

function LiveEmailCard({ compact }: { compact?: boolean }) {
  const { state, config } = useStore();
  if (!config) return null;
  const code = state?.sandbox?.code;
  if (compact) {
    return (
      <p className="text-[13px] text-muted">
        {code ? (
          <>
            Email <span className="font-medium text-ink">{config.inboundAddress}</span> with <span className="code font-semibold text-carbon">{code}</span> in the subject.
          </>
        ) : (
          <>Process the inbox to get your own code for live email.</>
        )}
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-white/6 p-3">
      <div className="text-xs text-white/50">Try it live</div>
      {code ? (
        <>
          <p className="mt-1 text-[13px] leading-snug text-white/90">
            Email <span className="font-medium">{config.inboundAddress}</span> with <span className="code font-semibold text-white">{code}</span> in the subject.
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-white/50">Mention {config.hintOrderRef} to see an order lookup.</p>
        </>
      ) : (
        <p className="mt-1 text-[13px] leading-snug text-white/70">Process the inbox first; you'll get a code to email {config.inboundAddress}.</p>
      )}
    </div>
  );
}

function ResetButton({ light }: { light?: boolean }) {
  const { state, refresh, setNotice } = useStore();
  const [armed, setArmed] = useState(false);
  if (!state?.sandbox) return null;
  return (
    <button
      className={light ? "btn-secondary w-full" : `btn w-full border ${armed ? "border-white/50 bg-white/10 text-white" : "border-white/15 text-white/75 hover:border-white/35 hover:text-white"}`}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
          return;
        }
        setArmed(false);
        try {
          await api.reset();
          await refresh();
        } catch (e) {
          setNotice(e instanceof Error ? e.message : String(e));
        }
      }}
    >
      {armed ? "Click again to reset" : "Reset demo"}
    </button>
  );
}

function Privacy({ light }: { light?: boolean }) {
  const { config } = useStore();
  return (
    <p className={`text-[11px] leading-relaxed ${light ? "text-muted" : "text-white/40"}`}>
      Demo by Fillorie. Companies and orders are fictional. Emails you send are processed by an AI provider, visible only in your sandbox, and deleted after {config?.retentionDays ?? 7} days. Please don't include personal data.
    </p>
  );
}

/** An envelope on the carbon tile: the product mark. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#3a4bc9" />
      <path d="M8 10h16v12H8z" fill="#fff" />
      <path d="M8 10l8 6 8-6" fill="none" stroke="#3a4bc9" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
