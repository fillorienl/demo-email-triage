import type { ReactNode } from "react";
import type { EmailSummary, Lane } from "../api";

export const LANE_STYLE: Record<Lane, { text: string; soft: string; dot: string; label: string }> = {
  ready: { text: "text-ready", soft: "bg-ready-soft", dot: "bg-ready", label: "Ready to send" },
  needs_look: { text: "text-review", soft: "bg-review-soft", dot: "bg-review", label: "Needs a look" },
  escalated: { text: "text-blocked", soft: "bg-blocked-soft", dot: "bg-blocked", label: "Escalated" },
  archived: { text: "text-manual", soft: "bg-manual-soft", dot: "bg-manual", label: "Archived" },
};

export function LaneBadge({ lane }: { lane: Lane }) {
  const s = LANE_STYLE[lane];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.soft} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Chip({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "carbon" | "ok" | "warn" | "bad"; title?: string }) {
  const cls = {
    plain: "bg-paper text-muted",
    carbon: "bg-carbon-soft text-carbon-dark",
    ok: "bg-ready-soft text-ready",
    warn: "bg-review-soft text-review",
    bad: "bg-blocked-soft text-blocked",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function AiModeChip({ mode }: { mode?: EmailSummary["aiMode"] }) {
  if (!mode) return null;
  if (mode === "cached") return <Chip title="Seed emails replay an earlier real AI result, with today's facts filled in.">cached AI result</Chip>;
  if (mode === "fixture") return <Chip tone="warn">test fixture</Chip>;
  return <Chip tone="carbon">live AI</Chip>;
}

export const CATEGORY_LABEL: Record<string, string> = {
  where_is_my_order: "Where is my order",
  return_request: "Return",
  complaint: "Complaint",
  order_change: "Order change",
  invoice_question: "Invoice",
  product_question: "Product question",
  other: "Other",
  spam: "Spam / newsletter",
};

export function timeAgo(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}
