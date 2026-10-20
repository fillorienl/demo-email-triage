/**
 * Mock order system: the reference data in code, RMAs written through a callback (D1 in the worker).
 * Replace with an Exact Online / AFAS / Shopify adapter for a real client.
 */
import { normalizeRef, orderMatchesRef, senderDomain, type OrderSystem } from "../core/lookup";
import { buildOrders, CUSTOMERS, productBySku } from "./reference";

export type RmaWriter = (sandboxId: string, rmaNumber: string, orderId: string, orderLineIds: string[], emailId: string) => Promise<void>;

export function mockOrderSystem(today: string, writeRma: RmaWriter = async () => {}): OrderSystem {
  const { orders, shipments } = buildOrders(today);
  return {
    async findCustomerByEmail(email) {
      const domain = senderDomain(email);
      return CUSTOMERS.find((c) => c.domain === domain) ?? null;
    },
    async getOrder(ref) {
      if (!normalizeRef(ref)) return null;
      return orders.find((o) => orderMatchesRef(o, ref)) ?? null;
    },
    async openOrders(debtorId) {
      return orders.filter((o) => o.debtorId === debtorId && (o.status === "open" || o.status === "partially_shipped" || o.status === "shipped"));
    },
    async shipments(orderId) {
      return shipments.filter((s) => s.orderId === orderId);
    },
    async product(sku) {
      return productBySku(sku) ?? null;
    },
    async createRma(sandboxId, rmaNumber, orderId, orderLineIds, emailId) {
      await writeRma(sandboxId, rmaNumber, orderId, orderLineIds, emailId);
      return rmaNumber;
    },
  };
}
