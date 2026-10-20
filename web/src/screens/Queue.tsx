import { Chip, timeAgo } from "../components/ui";
import { Link } from "../router";
import { useStore } from "../store";

export function Queue() {
  const { state } = useStore();
  const items = (state?.emails ?? []).filter((e) => e.lane === "escalated");
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Person queue</h1>
        <p className="mt-1 text-sm text-muted">Emails the rules hand to a person, with the reason in one line and who it goes to.</p>
      </header>
      {items.length === 0 ? (
        <div className="panel px-4 py-10 text-center text-sm text-muted">
          Nothing escalated yet. <Link href="/" className="text-carbon underline">Process the inbox</Link> first.
        </div>
      ) : (
        <div className="panel divide-y divide-line">
          {items.map((e) => (
            <Link key={e.id} href={`/email/${e.id}`} className="grid gap-2 px-4 py-3 hover:bg-paper sm:grid-cols-[1fr_220px] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{e.subject}</span>
                  {e.urgency === "high" && <Chip tone="bad">urgent</Chip>}
                  {e.status === "sent" && <Chip tone="ok">holding reply sent</Chip>}
                </div>
                <div className="text-xs text-muted">
                  {e.fromName} · {timeAgo(e.receivedAt)}
                </div>
                <div className="mt-1 text-[13px] text-blocked">{e.reason}</div>
              </div>
              <div className="text-sm sm:text-right">
                <div className="font-medium">{e.routeTo ?? "Service lead"}</div>
                <div className="text-xs text-muted">{e.draftKind === "holding" ? "Holding reply ready" : e.draftKind === "suggested" ? "Suggested reply attached" : "No draft"}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
