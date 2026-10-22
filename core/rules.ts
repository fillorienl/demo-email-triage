/**
 * Routing rules. One table, read top to bottom, first match wins.
 * The AI only supplies the reading (category, flags); every lane decision is made here.
 */
import type { LookupContext, ReadResult, RouteResult } from "./types";

export interface Signals {
  automated: boolean;
  suspicious: boolean;
  complaintOrThreat: boolean;
  invoice: boolean;
  orderChange: boolean;
  isReturn: boolean;
  isWhereIsMyOrder: boolean;
  multiIntent: boolean;
  senderKnown: boolean;
  hasOrder: boolean;
  orderOfOtherCustomer: boolean;
  severalOpenOrders: boolean;
  late: boolean;
  returnRefused: boolean;
  returnConditionUnconfirmed: boolean;
  lowConfidence: boolean;
}

export const LOW_CONFIDENCE = 0.7;

export function signals(read: ReadResult, ctx: LookupContext): Signals {
  const has = (c: ReadResult["category"]) => read.category === c || read.secondary_intents.includes(c);
  const order = ctx.order;
  const unshipped = order?.lines.some((l) => l.status === "open" || l.status === "backorder") ?? false;
  return {
    automated: read.category === "spam" || read.is_automated,
    suspicious: read.contains_instructions_to_assistant,
    complaintOrThreat: read.category === "complaint" || read.threatens_to_leave_or_legal,
    invoice: read.category === "invoice_question",
    orderChange: has("order_change"),
    isReturn: read.category === "return_request",
    isWhereIsMyOrder: read.category === "where_is_my_order",
    multiIntent: read.secondary_intents.some((c) => c !== read.category),
    senderKnown: !!ctx.customer,
    hasOrder: !!order,
    orderOfOtherCustomer: !!order && order.debtorId !== ctx.customer?.debtorId,
    severalOpenOrders: ctx.orderMatch === "several_open_orders",
    late: !!order && unshipped && order.promisedOn < ctx.today,
    returnRefused: ctx.returnDecisions.some((d) => !d.allowed),
    returnConditionUnconfirmed: read.category === "return_request" && read.item_condition === "unknown",
    lowConfidence: read.confidence < LOW_CONFIDENCE,
  };
}

interface Rule extends RouteResult {
  when: (s: Signals) => boolean;
}

const SERVICE_LEAD = "Service lead";

export const RULES: Rule[] = [
  { ruleId: "archive_automated", when: (s) => s.automated && !s.suspicious, lane: "archived", reason: "Newsletter, spam or auto-reply", routeTo: null, draft: "none" },
  {
    ruleId: "escalate_suspicious",
    when: (s) => s.suspicious,
    lane: "escalated",
    reason: "Contains instructions aimed at the assistant; nothing is promised or sent",
    routeTo: `${SERVICE_LEAD} (security check)`,
    draft: "none",
  },
  {
    ruleId: "escalate_complaint",
    when: (s) => s.complaintOrThreat,
    lane: "escalated",
    reason: "Complaint or threat to leave: a person handles this",
    routeTo: SERVICE_LEAD,
    draft: "holding",
  },
  { ruleId: "escalate_invoice", when: (s) => s.invoice, lane: "escalated", reason: "Invoice question: goes to accounts receivable", routeTo: "Debiteuren (finance)", draft: "none" },
  {
    ruleId: "look_order_change",
    when: (s) => s.orderChange,
    lane: "needs_look",
    reason: "Order changes are never made automatically",
    routeTo: "Sales office",
    draft: "reply",
  },
  {
    ruleId: "escalate_return_refused",
    when: (s) => s.isReturn && s.returnRefused,
    lane: "escalated",
    reason: "Return not allowed under the return policy: a person decides, suggested reply attached",
    routeTo: SERVICE_LEAD,
    draft: "suggested",
  },
  {
    ruleId: "look_sender_not_on_file",
    when: (s) => s.hasOrder && s.orderOfOtherCustomer,
    lane: "needs_look",
    reason: "Order reference belongs to another customer than the sender: no order details in the draft",
    routeTo: null,
    draft: "reply",
  },
  { ruleId: "look_low_confidence", when: (s) => s.lowConfidence, lane: "needs_look", reason: "The AI was not confident about what this email asks", routeTo: null, draft: "reply" },
  {
    ruleId: "ready_ask_order_number",
    when: (s) => (s.isWhereIsMyOrder || s.isReturn) && !s.hasOrder && !s.senderKnown,
    lane: "ready",
    reason: "Unknown sender, no order number: ask for it",
    routeTo: null,
    draft: "reply",
  },
  { ruleId: "look_several_orders", when: (s) => s.severalOpenOrders && !s.hasOrder, lane: "needs_look", reason: "Several open orders and no order number given", routeTo: null, draft: "reply" },
  { ruleId: "look_no_order", when: (s) => (s.isWhereIsMyOrder || s.isReturn) && !s.hasOrder, lane: "needs_look", reason: "No matching order found", routeTo: null, draft: "reply" },
  { ruleId: "look_late", when: (s) => s.isWhereIsMyOrder && s.late, lane: "needs_look", reason: "Promised delivery date has passed", routeTo: null, draft: "reply" },
  {
    ruleId: "look_return_unconfirmed",
    when: (s) => s.returnConditionUnconfirmed,
    lane: "needs_look",
    reason: "Return is in the window, but the customer didn't say the goods are unopened",
    routeTo: null,
    draft: "reply",
  },
  { ruleId: "ready_return", when: (s) => s.isReturn && s.hasOrder && !s.returnRefused, lane: "ready", reason: "Return allowed under policy; RMA is created when you send", routeTo: null, draft: "reply" },
  { ruleId: "look_multi_intent", when: (s) => s.multiIntent, lane: "needs_look", reason: "Asks more than one thing", routeTo: null, draft: "reply" },
  { ruleId: "ready_where_is_my_order", when: (s) => s.isWhereIsMyOrder && s.hasOrder, lane: "ready", reason: "Order and shipment found", routeTo: null, draft: "reply" },
  { ruleId: "look_default", when: () => true, lane: "needs_look", reason: "No automatic rule for this kind of question", routeTo: null, draft: "reply" },
];

export function route(read: ReadResult, ctx: LookupContext): RouteResult {
  const s = signals(read, ctx);
  const rule = RULES.find((r) => r.when(s))!;
  const { when: _when, ...result } = rule;
  return result;
}
