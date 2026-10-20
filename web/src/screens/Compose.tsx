import { useState } from "react";
import { api } from "../api";
import { navigate } from "../router";
import { useStore } from "../store";

const PRESETS = [
  {
    label: "Known customer asks about PO 4471",
    fromName: "Ruud Smeenk",
    fromEmail: "inkoop@hofstede-machinebouw.nl",
    subject: "Status PO 4471",
    body: "Hoi, kunnen jullie de track & trace van PO 4471 nog een keer sturen? Ik kan de mail niet meer vinden.\n\nGroet, Ruud",
  },
  {
    label: "Unknown sender wants to return something",
    fromName: "Lisa",
    fromEmail: "lisa.demo@example.com",
    subject: "Retour",
    body: "Hello, I'd like to return some safety glasses we ordered last month. How does that work?\n\nLisa",
  },
  { label: "Blank", fromName: "", fromEmail: "", subject: "", body: "" },
];

export function Compose() {
  const { ensureSandbox, processOne, takeToken, config, state, setNotice } = useStore();
  const [f, setF] = useState(PRESETS[0]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!(await ensureSandbox())) return;
      const { id } = await api.compose({ fromName: f.fromName, fromEmail: f.fromEmail, subject: f.subject, body: f.body, turnstileToken: config?.turnstileSiteKey ? takeToken() : null });
      navigate(`/email/${id}`);
      await processOne(id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Compose a test email</h1>
        <p className="mt-1 text-sm text-muted">
          Write as a customer, straight into this inbox. Handy on a screen-share. It uses live AI ({state?.usage ? `${state.usage.liveToday} of ${state.usage.liveCap}` : `up to ${config?.liveCap ?? 20}`} live emails per day per sandbox).
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className={`btn-secondary ${f.label === p.label ? "border-carbon" : ""}`} onClick={() => setF(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <form className="panel space-y-4 p-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label">From name</span>
            <input className="field mt-1" value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">From address</span>
            <input className="field mt-1" type="email" required value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value })} />
          </label>
        </div>
        <p className="-mt-2 text-xs text-muted">Customers are matched on the domain: try @hofstede-machinebouw.nl, @klaassen-installatie.nl or @dekkerfood.com.</p>
        <label className="block">
          <span className="label">Subject</span>
          <input className="field mt-1" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Message</span>
          <textarea className="field mt-1 min-h-[180px]" required maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy}>
            {busy && <span className="spinner" />} Send to the inbox and triage
          </button>
          <span className="text-xs text-muted">Don't include real personal data.</span>
        </div>
      </form>
    </div>
  );
}
