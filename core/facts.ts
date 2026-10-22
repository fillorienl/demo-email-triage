/**
 * Builds the facts block for the draft step. Code decides what is true; the AI only phrases it.
 * Dates are pre-formatted in the customer's language, so the draft can copy them exactly
 * and the grounding check can compare like with like.
 */
import { formatDate } from "./dates";
import type { Facts, Lang, LookupContext, ReadResult, RouteResult } from "./types";

export interface FactsExtras {
  rmaNumber?: string;
  returnAddress: string;
  policyText: string;
}

export function replyLanguage(read: ReadResult, ctx: LookupContext): Lang {
  if (read.language === "nl" || read.language === "en" || read.language === "de") return read.language;
  return ctx.customer?.lang ?? "en";
}

export function buildFacts(read: ReadResult, ctx: LookupContext, routed: RouteResult, lang: Lang, extras: FactsExtras): Facts {
  const f: Facts = {};
  const date = (iso: string) => formatDate(iso, lang);

  if (ctx.customer) f.customer_name = ctx.customer.name;
  else f.sender_on_file = "no: sender's email address is not linked to a customer account";

  // An order that isn't the sender's own never reaches the draft: not its lines, dates, shipments or returns.
  const o = ctx.order && ctx.order.debtorId === ctx.customer?.debtorId ? ctx.order : null;
  if (o) {
    f.order_number = o.id;
    f.customer_order_reference = o.customerRef;
    f.order_date = date(o.orderedOn);
    f.promised_delivery_date = date(o.promisedOn);
    f.order_lines = o.lines.map((l) => `${l.qty} × ${l.description} (${l.unit})`).join("; ");

    ctx.shipments.forEach((s, i) => {
      const k = ctx.shipments.length === 1 ? "shipment" : `shipment_${i + 1}`;
      const contents = o.lines.filter((l) => s.lineIds.includes(l.id)).map((l) => `${l.qty} × ${l.description}`);
      f[`${k}_contents`] = contents.join("; ");
      f[`${k}_carrier`] = s.carrier;
      f[`${k}_tracking_code`] = s.trackingCode;
      f[`${k}_tracking_link`] = s.trackingUrl;
      f[`${k}_shipped_on`] = date(s.shippedOn);
      f[`${k}_status`] = s.status === "delivered" ? "delivered" : "on its way";
      f[`${k}_expected_delivery`] = date(s.eta);
    });

    const back = o.lines.filter((l) => l.status === "backorder");
    if (back.length) {
      f.backorder_items = back.map((l) => `${l.qty} × ${l.description}`).join("; ");
      const dates = [...new Set(back.map((l) => l.expectedOn).filter(Boolean) as string[])].sort();
      if (dates.length) f.backorder_expected_delivery = date(dates[dates.length - 1]);
      if (o.promisedOn < ctx.today) f.promised_date_passed = "yes: the promised delivery date has passed, apologise";
    }
    const delivered = o.lines.filter((l) => l.status === "delivered" && l.deliveredOn);
    if (delivered.length && !ctx.shipments.length) f.delivered_on = date(delivered[0].deliveredOn!);
  } else if (ctx.order) {
    f.order_found =
      "not shared: the order reference in the email is not linked to the sender's email address. Do not confirm, deny or describe anything about that order; say a colleague will check it and get back to them";
  } else if (ctx.orderMatch === "several_open_orders") {
    f.order_found = "no: the customer has several open orders; ask which order number they mean";
  } else {
    f.order_found = "no: ask for the order number or customer order reference";
  }

  if (ctx.returnDecisions.length && o) {
    const items = (ids: string[]) => o.lines.filter((l) => ids.includes(l.id)).map((l) => `${l.qty} × ${l.description}`).join("; ");
    const ok = ctx.returnDecisions.filter((d) => d.allowed);
    const refused = ctx.returnDecisions.filter((d) => !d.allowed);
    if (ok.length && !refused.length) {
      f.return_decision = "approved";
      f.return_items = items(ok.map((d) => d.lineId));
      if (extras.rmaNumber) f.rma_number = extras.rmaNumber;
      f.return_instructions = `Write the RMA number on the box and send it to ${extras.returnAddress}.`;
      const deadline = ok.map((d) => d.deadline).filter(Boolean).sort()[0];
      if (deadline) f.return_before = date(deadline);
      if (read.category === "return_request" && /size|maat|größe|replace|vervang|ersatz|instead|in plaats/i.test(read.sub_reason)) {
        f.replacement = "not arranged automatically; a colleague from sales confirms the replacement order separately";
      }
    } else {
      f.return_decision = "not allowed";
      f.return_items = items(refused.map((d) => d.lineId));
      f.return_reason = refused.map((d) => d.reason).join("; ");
      f.return_policy = extras.policyText;
    }
  }

  if (routed.draft === "holding") f.next_step = "a colleague from the service team will contact the customer personally";
  if (routed.ruleId === "look_order_change") f.order_change = "not made automatically; the sales office checks it and confirms";

  return f;
}
