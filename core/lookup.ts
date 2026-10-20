/**
 * Plain-code lookup: who sent this, which order is it about, what does the return policy say.
 * Works against the OrderSystem interface, so a client's ERP or webshop can replace the mock.
 */
import { addDays, daysBetween } from "./dates";
import type { Customer, LookupContext, Order, Product, ReadResult, ReturnDecision, Shipment } from "./types";

export interface OrderSystem {
  findCustomerByEmail(email: string): Promise<Customer | null>;
  /** Accepts "PO 4471", "4471", "VIS-SO-26-1187", "Bestellung B-7730". */
  getOrder(ref: string): Promise<Order | null>;
  openOrders(debtorId: string): Promise<Order[]>;
  shipments(orderId: string): Promise<Shipment[]>;
  product(sku: string): Promise<(Product & { keywords?: string[] }) | null>;
  /** Only called when a person clicks Send on an approved return. */
  createRma(sandboxId: string, rmaNumber: string, orderId: string, orderLineIds: string[], emailId: string): Promise<string>;
}

export interface ReturnPolicy {
  windowDays: number;
  requiresUnopened: boolean;
}

const REF_PREFIX = /^(po|p\.o\.|order|ordernummer|ordernr|bestelling|bestellung|bestelnummer|uw ref|our ref|ref|nr|no|#)[\s.:#-]*/i;

export function normalizeRef(ref: string): string {
  let r = ref.trim();
  for (let i = 0; i < 3; i++) r = r.replace(REF_PREFIX, "");
  return r.replace(/\s+/g, "").toUpperCase();
}

export function orderMatchesRef(order: Order, ref: string): boolean {
  const r = normalizeRef(ref);
  return r.length > 0 && (normalizeRef(order.id) === r || normalizeRef(order.customerRef) === r);
}

export function senderDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase().trim() ?? "";
}

/** Delivered/shipped lines the email is about, matched on product words; all lines if nothing matches. */
export async function linesMentioned(order: Order, read: ReadResult, emailText: string, os: OrderSystem) {
  const text = (read.products.join(" ") + " " + emailText).toLowerCase();
  const scored = await Promise.all(
    order.lines.map(async (l) => {
      const p = await os.product(l.sku);
      const words = p?.keywords ?? [];
      return { line: l, hits: words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)).length };
    }),
  );
  const best = Math.max(0, ...scored.map((s) => s.hits));
  return best === 0 ? order.lines : scored.filter((s) => s.hits === best).map((s) => s.line);
}

export function decideReturn(
  line: Order["lines"][number],
  product: Product | null,
  condition: ReadResult["item_condition"],
  today: string,
  policy: ReturnPolicy,
): ReturnDecision {
  if (product && !product.returnable) {
    return { lineId: line.id, allowed: false, reason: `not returnable: ${product.notReturnableReason ?? "excluded by policy"}` };
  }
  if (line.status !== "delivered" || !line.deliveredOn) {
    return { lineId: line.id, allowed: false, reason: "not delivered yet" };
  }
  const deadline = addDays(line.deliveredOn, policy.windowDays);
  if (daysBetween(line.deliveredOn, today) > policy.windowDays) {
    return { lineId: line.id, allowed: false, reason: `outside the ${policy.windowDays}-day return window`, deadline };
  }
  if (policy.requiresUnopened && (condition === "opened" || condition === "damaged")) {
    return { lineId: line.id, allowed: false, reason: `packaging ${condition}; policy requires unopened`, deadline };
  }
  if (policy.requiresUnopened && condition === "unknown") {
    return { lineId: line.id, allowed: true, reason: "within window; unopened not confirmed by customer", deadline };
  }
  return { lineId: line.id, allowed: true, reason: `within ${policy.windowDays} days and unopened`, deadline };
}

export async function lookup(
  read: ReadResult,
  fromEmail: string,
  emailText: string,
  os: OrderSystem,
  today: string,
  policy: ReturnPolicy,
): Promise<LookupContext> {
  const customer = await os.findCustomerByEmail(fromEmail);

  let order: Order | null = null;
  let orderMatch: LookupContext["orderMatch"] = "none";
  for (const ref of read.order_refs) {
    order = await os.getOrder(ref);
    if (order) {
      orderMatch = "by_ref";
      break;
    }
  }
  if (!order && customer) {
    const open = await os.openOrders(customer.debtorId);
    if (open.length === 1) {
      order = open[0];
      orderMatch = "only_open_order";
    } else if (open.length > 1) {
      orderMatch = "several_open_orders";
    }
  }

  const shipments = order ? await os.shipments(order.id) : [];

  const returnDecisions: ReturnDecision[] = [];
  if (order && (read.category === "return_request" || read.secondary_intents.includes("return_request"))) {
    for (const l of await linesMentioned(order, read, emailText, os)) {
      returnDecisions.push(decideReturn(l, await os.product(l.sku), read.item_condition, today, policy));
    }
  }

  return { customer, order, orderMatch, shipments, returnDecisions, today };
}
