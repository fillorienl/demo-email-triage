import { useEffect, useState } from "react";
import { shortDate } from "../../../core/dates";
import { api, type SystemData } from "../api";
import { Chip, clock } from "../components/ui";
import { Link } from "../router";

const TABS = ["Orders", "Outbox", "RMAs", "Audit log", "Customers & products"] as const;

export function SystemScreen() {
  const [data, setData] = useState<SystemData | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Orders");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.system().then(setData, (e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <p className="text-blocked">{error}</p>;
  if (!data) return <p className="text-muted">Loading…</p>;

  const customer = (id: string) => data.customers.find((c) => c.debtorId === id)?.name ?? id;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mock order system</h1>
        <p className="mt-1 text-sm text-muted">
          What the triage looks things up in, and what happened after a person clicked. Behind an adapter, so a real ERP or webshop plugs in here.
        </p>
      </header>
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-carbon font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Outbox" && data.outbox.length > 0 && <span className="ml-1.5 text-xs text-muted">{data.outbox.length}</span>}
            {t === "RMAs" && data.rmas.length > 0 && <span className="ml-1.5 text-xs text-muted">{data.rmas.length}</span>}
          </button>
        ))}
      </div>

      {tab === "Orders" && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 font-medium">Lines</th>
                <th className="px-4 py-2 font-medium">Shipment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {data.orders.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2.5">
                    <div className="code">{o.id}</div>
                    <div className="text-xs text-muted">ref {o.customerRef}</div>
                  </td>
                  <td className="px-4 py-2.5">{customer(o.debtorId)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <div>Ordered {shortDate(o.orderedOn)}</div>
                    <div>Promised {shortDate(o.promisedOn)}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {o.lines.map((l) => (
                      <div key={l.id}>
                        {l.qty} × {l.description}{" "}
                        <span className="text-xs text-muted">
                          {l.status}
                          {l.expectedOn ? ` → ${shortDate(l.expectedOn)}` : ""}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {data.shipments
                      .filter((s) => s.orderId === o.id)
                      .map((s) => (
                        <div key={s.id}>
                          {s.carrier} <span className="code">{s.trackingCode}</span>
                          <div className="text-muted">ETA {shortDate(s.eta)}</div>
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Return policy: {data.policy}</p>
        </div>
      )}

      {tab === "Outbox" && (
        <div className="space-y-3">
          <p className="text-xs text-muted">Replies "sent" from the review screen land here. Nothing is ever emailed.</p>
          {data.outbox.length === 0 && <Empty>No replies sent yet.</Empty>}
          {data.outbox.map((m) => (
            <article key={m.id} className="panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span>
                  <span className="text-muted">To</span> {m.to_addr} · <span className="font-medium">{m.subject}</span>
                </span>
                <span className="text-xs text-muted">{clock(m.sent_at)}</span>
              </div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{m.body}</pre>
              <Link href={`/email/${m.email_id}`} className="mt-2 inline-block text-xs text-carbon underline">
                Open the original email
              </Link>
            </article>
          ))}
        </div>
      )}

      {tab === "RMAs" && (
        <div className="panel divide-y divide-line">
          {data.rmas.length === 0 && <Empty>No return authorisations yet. They are created when you send an approved return reply.</Empty>}
          {data.rmas.map((r) => (
            <div key={r.rma_number} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]">
              <span>
                <span className="code font-medium">{r.rma_number}</span> for <span className="code">{r.order_id}</span> · lines {JSON.parse(r.line_ids).join(", ")}
              </span>
              <span className="text-xs text-muted">{clock(r.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "Audit log" && (
        <div className="panel p-4">
          {data.audit.length === 0 && <Empty>Nothing logged yet.</Empty>}
          <ol className="space-y-1.5">
            {data.audit.map((a, i) => (
              <li key={i} className="grid grid-cols-[110px_64px_1fr] gap-3 text-[13px]">
                <span className="text-faint">{clock(a.at)}</span>
                <span className={a.actor === "ai" ? "text-carbon" : a.actor === "person" ? "text-ready" : "text-muted"}>{a.actor === "ai" ? "AI" : a.actor}</span>
                <span>
                  {a.action}
                  {a.detail && <span className="text-muted"> · {a.detail}</span>}
                  {a.email_id && (
                    <Link href={`/email/${a.email_id}`} className="ml-1.5 text-xs text-carbon underline">
                      open
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === "Customers & products" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel divide-y divide-line">
            {data.customers.map((c) => (
              <div key={c.debtorId} className="px-4 py-2.5 text-[13px]">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted">
                  {c.debtorId} · @{c.domain} · {c.city}, {c.country}
                </div>
              </div>
            ))}
          </div>
          <div className="panel divide-y divide-line">
            {data.products.map((p) => (
              <div key={p.sku} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span>
                  {p.description} <span className="code text-xs text-muted">{p.sku}</span>
                </span>
                {p.returnable ? <Chip>returnable</Chip> : <Chip tone="bad">not returnable</Chip>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}
