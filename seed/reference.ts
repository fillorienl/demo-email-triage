/**
 * Veldhuis Industrial Supply's customers, products, orders and shipments.
 * Shared and read-only. Dates are built relative to "today" so the late-delivery
 * and return-window cases stay correct on whatever day the demo is opened.
 * SKUs and descriptions match the supplier invoice intake demo.
 */
import { addWorkdays } from "../core/dates";
import type { Customer, Order, Product, Shipment } from "../core/types";

export const COMPANY = {
  name: "Veldhuis Industrial Supply B.V.",
  address: "Veldhuis Industrial Supply B.V., Ceintuurbaan 118, 8024 AA Zwolle",
  serviceSignature: { nl: "Team Klantenservice", en: "Customer Service Team", de: "Kundenservice-Team" },
};

export const RETURN_POLICY = {
  windowDays: 30,
  requiresUnopened: true,
  text: "Returns within 30 days of delivery, unopened. Custom-cut items (such as hydraulic hose cut to length) cannot be returned.",
};

export const CUSTOMERS: Customer[] = [
  { debtorId: "D-10231", name: "Hofstede Machinebouw B.V.", domain: "hofstede-machinebouw.nl", city: "Hengelo", country: "NL", lang: "nl" },
  { debtorId: "D-10418", name: "Klaassen Installatietechniek B.V.", domain: "klaassen-installatie.nl", city: "Deventer", country: "NL", lang: "nl" },
  { debtorId: "D-10507", name: "Dekker Food Processing B.V.", domain: "dekkerfood.com", city: "Zwolle", country: "NL", lang: "en" },
  { debtorId: "D-10622", name: "Agro Hydrauliek Noord B.V.", domain: "agrohydrauliek-noord.nl", city: "Assen", country: "NL", lang: "nl" },
  { debtorId: "D-10734", name: "Bouwbedrijf Ter Horst B.V.", domain: "terhorstbouw.nl", city: "Apeldoorn", country: "NL", lang: "nl" },
  { debtorId: "D-20115", name: "Brandt Maschinenbau GmbH", domain: "brandt-maschinenbau.de", city: "Bocholt", country: "DE", lang: "de" },
];

export interface CatalogueProduct extends Product {
  /** Words a customer might use for it, in NL/EN/DE. Used to match "the gloves" to an order line. */
  keywords: string[];
}

export const PRODUCTS: CatalogueProduct[] = [
  { sku: "VIS-BT-M10x60-A2", description: "Zeskantbout M10x60 RVS A2 DIN933", unit: "doos 50", returnable: true, keywords: ["bout", "bouten", "bolt", "bolts", "schraube", "schrauben", "m10"] },
  { sku: "VIS-MO-M10-A2", description: "Zeskantmoer M10 RVS A2 DIN934", unit: "doos 100", returnable: true, keywords: ["moer", "moeren", "nut", "nuts", "mutter", "m10"] },
  { sku: "VIS-BT-M8x40-A2", description: "Zeskantbout M8x40 RVS A2 DIN933", unit: "doos 100", returnable: true, keywords: ["bout", "bouten", "bolt", "bolts", "m8"] },
  { sku: "VIS-MO-M8-A2", description: "Zeskantmoer M8 RVS A2 DIN934", unit: "doos 200", returnable: true, keywords: ["moer", "moeren", "nut", "nuts", "m8"] },
  { sku: "VIS-BT-M12x80-A4", description: "Zeskantbout M12x80 RVS A4 DIN933", unit: "doos 25", returnable: true, keywords: ["bout", "bouten", "bolt", "bolts", "m12", "a4"] },
  {
    sku: "VIS-HS-R2-38-1M",
    description: "Hydraulische slang R2 3/8, op maat geknipt",
    unit: "meter",
    returnable: false,
    notReturnableReason: "custom-cut to length",
    keywords: ["slang", "slangen", "hose", "schlauch", "hydraulische", "hydraulic"],
  },
  { sku: "VIS-HF-12L-38", description: "Hydraulische koppeling 12L 3/8 BSP", unit: "stuk", returnable: true, keywords: ["koppeling", "koppelingen", "fitting", "fittings", "kupplung"] },
  { sku: "VIS-PPE-HS-10", description: "Werkhandschoen nitril maat 10", unit: "paar", returnable: true, keywords: ["handschoen", "handschoenen", "glove", "gloves", "handschuhe", "nitril", "nitrile"] },
  { sku: "VIS-PPE-HS-09", description: "Werkhandschoen nitril maat 9", unit: "paar", returnable: true, keywords: ["handschoen", "handschoenen", "glove", "gloves", "handschuhe", "nitril", "nitrile"] },
  { sku: "VIS-PPE-VB-01", description: "Veiligheidsbril helder EN166", unit: "stuk", returnable: true, keywords: ["bril", "brillen", "glasses", "goggles", "schutzbrille"] },
  { sku: "VIS-KB-300-ZW", description: "Kabelbinder 300x4.8 zwart", unit: "zak 100", returnable: true, keywords: ["kabelbinder", "cable ties", "tie wraps", "kabelbinders"] },
  { sku: "VIS-KS-6-M6", description: "Kabelschoen 6 mm2 M6 vertind", unit: "zak 100", returnable: true, keywords: ["kabelschoen", "kabelschoenen", "cable lugs", "kabelschuhe"] },
];

export const productBySku = (sku: string) => PRODUCTS.find((p) => p.sku === sku);

function line(orderId: string, n: number, sku: string, qty: number, status: Order["lines"][number]["status"], extra: Partial<Order["lines"][number]> = {}) {
  const p = productBySku(sku);
  if (!p) throw new Error(`Unknown SKU ${sku}`);
  return { id: `${orderId}-${n}`, sku, description: p.description, qty, unit: p.unit, status, ...extra };
}

const dhl = (code: string) => `https://www.dhl.com/nl-nl/home/tracking/tracking-parcel.html?tracking-id=${code}`;

/** Orders and shipments as they look on `today`. */
export function buildOrders(today: string): { orders: Order[]; shipments: Shipment[] } {
  const wd = (n: number) => addWorkdays(today, n);

  const orders: Order[] = [
    // #1: shipped yesterday via DHL
    {
      id: "VIS-SO-26-1187",
      customerRef: "4471",
      debtorId: "D-10231",
      orderedOn: wd(-4),
      promisedOn: wd(1),
      status: "shipped",
      lines: [line("VIS-SO-26-1187", 1, "VIS-BT-M10x60-A2", 10, "shipped"), line("VIS-SO-26-1187", 2, "VIS-MO-M10-A2", 10, "shipped")],
    },
    // Older Hofstede order, delivered: not open, so it never confuses "where is my order"
    {
      id: "VIS-SO-26-1098",
      customerRef: "4402",
      debtorId: "D-10231",
      orderedOn: wd(-18),
      promisedOn: wd(-14),
      status: "delivered",
      lines: [line("VIS-SO-26-1098", 1, "VIS-BT-M10x60-A2", 6, "delivered", { deliveredOn: wd(-14) })],
    },
    // #2 and #9: Klaassen's only open order, on backorder, promised date passed
    {
      id: "VIS-SO-26-1143",
      customerRef: "KL-2026-311",
      debtorId: "D-10418",
      orderedOn: wd(-9),
      promisedOn: wd(-3),
      status: "open",
      lines: [
        line("VIS-SO-26-1143", 1, "VIS-BT-M8x40-A2", 40, "backorder", { expectedOn: wd(4) }),
        line("VIS-SO-26-1143", 2, "VIS-MO-M8-A2", 20, "backorder", { expectedOn: wd(4) }),
      ],
    },
    // #3: gloves delivered 7 working days ago (about 9 calendar days)
    {
      id: "VIS-SO-26-1102",
      customerRef: "DFP-55821",
      debtorId: "D-10507",
      orderedOn: wd(-10),
      promisedOn: wd(-7),
      status: "delivered",
      lines: [
        line("VIS-SO-26-1102", 1, "VIS-PPE-HS-10", 50, "delivered", { deliveredOn: wd(-7) }),
        line("VIS-SO-26-1102", 2, "VIS-PPE-VB-01", 20, "delivered", { deliveredOn: wd(-7) }),
      ],
    },
    // #4: 25 m custom-cut hose
    {
      id: "VIS-SO-26-1120",
      customerRef: "AHN-0937",
      debtorId: "D-10622",
      orderedOn: wd(-7),
      promisedOn: wd(-4),
      status: "delivered",
      lines: [
        line("VIS-SO-26-1120", 1, "VIS-HS-R2-38-1M", 25, "delivered", { deliveredOn: wd(-4) }),
        line("VIS-SO-26-1120", 2, "VIS-HF-12L-38", 8, "delivered", { deliveredOn: wd(-4) }),
      ],
    },
    // #5: delivered two days ago (wrong item, per the customer)
    {
      id: "VIS-SO-26-1161",
      customerRef: "TH-26-118",
      debtorId: "D-10734",
      orderedOn: wd(-5),
      promisedOn: wd(-2),
      status: "delivered",
      lines: [line("VIS-SO-26-1161", 1, "VIS-BT-M12x80-A4", 4, "delivered", { deliveredOn: wd(-2) })],
    },
    // #7: partly shipped, rest on backorder but still inside the promised date
    {
      id: "VIS-SO-26-1171",
      customerRef: "B-7730",
      debtorId: "D-20115",
      orderedOn: wd(-6),
      promisedOn: wd(6),
      status: "partially_shipped",
      lines: [
        line("VIS-SO-26-1171", 1, "VIS-KB-300-ZW", 30, "shipped"),
        line("VIS-SO-26-1171", 2, "VIS-KS-6-M6", 10, "backorder", { expectedOn: wd(5) }),
      ],
    },
  ];

  const shipments: Shipment[] = [
    {
      id: "SHP-88412",
      orderId: "VIS-SO-26-1187",
      lineIds: ["VIS-SO-26-1187-1", "VIS-SO-26-1187-2"],
      carrier: "DHL",
      trackingCode: "JVGL0612345678",
      trackingUrl: dhl("JVGL0612345678"),
      status: "in_transit",
      shippedOn: wd(-1),
      eta: wd(1),
    },
    {
      id: "SHP-88377",
      orderId: "VIS-SO-26-1171",
      lineIds: ["VIS-SO-26-1171-1"],
      carrier: "DHL",
      trackingCode: "JVGL0612349901",
      trackingUrl: dhl("JVGL0612349901"),
      status: "in_transit",
      shippedOn: wd(-2),
      eta: wd(1),
    },
  ];

  return { orders, shipments };
}
