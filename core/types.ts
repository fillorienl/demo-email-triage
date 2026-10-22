/** Shared types for the worker, the rules and the web app. */

export const CATEGORIES = [
  "where_is_my_order",
  "return_request",
  "complaint",
  "order_change",
  "invoice_question",
  "product_question",
  "other",
  "spam",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Lang = "nl" | "en" | "de";
export type Lane = "ready" | "needs_look" | "escalated" | "archived";

/** What the AI read step returns for one email. */
export interface ReadResult {
  category: Category;
  sub_reason: string;
  secondary_intents: Category[];
  order_refs: string[];
  invoice_refs: string[];
  products: string[];
  language: Lang | "other";
  sentiment: "positive" | "neutral" | "negative" | "angry";
  urgency: "low" | "normal" | "high";
  threatens_to_leave_or_legal: boolean;
  contains_instructions_to_assistant: boolean;
  is_automated: boolean;
  item_condition: "unopened" | "opened" | "damaged" | "unknown";
  confidence: number;
  summary: string;
}

export interface Customer {
  debtorId: string;
  name: string;
  domain: string;
  city: string;
  country: string;
  lang: Lang;
}

export interface Product {
  sku: string;
  description: string;
  unit: string;
  returnable: boolean;
  /** Why it can't be returned, shown in facts and the person queue. */
  notReturnableReason?: string;
}

export interface OrderLine {
  id: string;
  sku: string;
  description: string;
  qty: number;
  unit: string;
  status: "open" | "backorder" | "shipped" | "delivered";
  /** Delivery date for delivered lines. */
  deliveredOn?: string;
  /** New expected date for backorder lines. */
  expectedOn?: string;
}

export interface Order {
  id: string; // VIS-SO-26-1187
  customerRef: string; // the customer's own PO number, e.g. "4471"
  debtorId: string;
  orderedOn: string; // ISO date
  promisedOn: string; // ISO date
  status: "open" | "partially_shipped" | "shipped" | "delivered";
  lines: OrderLine[];
}

export interface Shipment {
  id: string;
  orderId: string;
  lineIds: string[];
  carrier: "DHL" | "PostNL";
  trackingCode: string;
  trackingUrl: string;
  status: "in_transit" | "delivered";
  shippedOn: string;
  eta: string;
}

export interface ReturnDecision {
  lineId: string;
  allowed: boolean;
  reason: string;
  deadline?: string;
}

/**
 * Everything code found about one email, before routing.
 * The draft step only sees `facts` (formatted strings), never this raw context.
 */
export interface LookupContext {
  customer: Customer | null;
  order: Order | null;
  /** How the order was found: by a reference in the email, the only open order, or not at all. */
  orderMatch: "by_ref" | "only_open_order" | "several_open_orders" | "none";
  shipments: Shipment[];
  returnDecisions: ReturnDecision[];
  today: string;
}

/** Key → value pairs handed to the draft step. Values are already formatted in the customer's language. */
export type Facts = Record<string, string>;

export interface RouteResult {
  lane: Lane;
  ruleId: string;
  reason: string;
  routeTo: string | null;
  draft: "reply" | "holding" | "suggested" | "none";
}

export interface GroundingIssue {
  kind: "date" | "amount" | "order_ref" | "tracking";
  text: string;
}

/** What the AI draft step returns. Only `body` ever goes to the customer. */
export interface DraftText {
  body: string;
  /** A question for the person reviewing the draft; null when the AI had nothing to ask. */
  reviewerNote: string | null;
}

export interface GroundingResult {
  ok: boolean;
  checked: number;
  issues: GroundingIssue[];
}

export type EmailStatus = "new" | "processing" | "triaged" | "sent" | "archived" | "error";
export type AiMode = "live" | "cached" | "fixture";
