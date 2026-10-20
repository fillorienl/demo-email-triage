import { useCallback, useEffect, useState } from "react";
import { api, type AdminOverview } from "../api";
import { clock } from "../components/ui";

export function Admin() {
  const [d, setD] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const load = useCallback(() => api.admin.overview().then(setD, (e) => setError(String(e.message ?? e))), []);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-blocked">{error}</p>;
  if (!d) return <p className="text-muted">Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const todays = d.counters.filter((c) => c.day === today);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">Behind Cloudflare Access. Model: {d.model}</p>
      </header>
      {msg && <p className="rounded-md bg-ready-soft px-3 py-2 text-sm text-ready">{msg}</p>}

      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="AI calls today" value={`${d.globalToday} / ${d.caps.global}`} />
        <Tile label="Live emails per sandbox per day" value={String(d.caps.perSandbox)} />
        <Tile label="Sandboxes (latest 100)" value={String(d.sandboxes.length)} />
      </section>

      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Counters today</h2>
        <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          {todays.length === 0 && <li className="text-muted">Nothing counted today.</li>}
          {todays.map((c) => (
            <li key={c.key} className="flex justify-between">
              <span className="code">{c.key}</span>
              <span className="tabular-nums">{c.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Seed AI cache · {d.modelKey}</h2>
          <button
            className="btn-secondary"
            onClick={async () => {
              const r = await api.admin.clearCache();
              setMsg(`Cleared ${r.deleted} cached results. The next run of each seed email uses live AI and refills the cache.`);
              load();
            }}
          >
            Clear cache (refresh with live AI)
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">A first real run is only cached when the email lands in its expected lane.</p>
        <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          {Array.from({ length: 11 }, (_, i) => i + 1).map((no) => {
            const c = d.cache.find((x) => x.seed_no === no && x.model_key === d.modelKey);
            return (
              <li key={no} className="flex justify-between">
                <span>Seed #{no}</span>
                <span className="text-muted">{c ? `cached ${clock(c.created_at)}` : "not cached"}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Sandboxes</h2>
          <button
            className="btn-danger"
            onClick={async () => {
              if (!armed) {
                setArmed(true);
                setTimeout(() => setArmed(false), 4000);
                return;
              }
              setArmed(false);
              const r = await api.admin.clearSandboxes();
              setMsg(`Deleted ${r.deleted} sandboxes.`);
              load();
            }}
          >
            {armed ? "Click again to delete all" : "Delete all sandboxes"}
          </button>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Code</th>
                <th className="py-1 font-medium">Created</th>
                <th className="py-1 font-medium">Last seen</th>
                <th className="py-1 font-medium">Emails</th>
                <th className="py-1 font-medium">Live</th>
                <th className="py-1 font-medium">AI today</th>
              </tr>
            </thead>
            <tbody>
              {d.sandboxes.map((s) => (
                <tr key={s.code} className="border-t border-line">
                  <td className="code py-1">{s.code}</td>
                  <td className="py-1">{clock(s.created_at)}</td>
                  <td className="py-1">{clock(s.last_seen_at)}</td>
                  <td className="py-1 tabular-nums">{s.emails}</td>
                  <td className="py-1 tabular-nums">{s.live}</td>
                  <td className="py-1 tabular-nums">{s.ai_today ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
