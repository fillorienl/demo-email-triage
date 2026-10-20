/**
 * Grounding check: every date, amount, link, order number and tracking code in a draft
 * must come from the facts block (or, for references and dates, the customer's own email).
 * Amounts must be in the facts: an amount the customer mentions is never confirmed back.
 */
import type { Facts, GroundingIssue, GroundingResult } from "./types";

const MONTHS: Record<string, number> = {};
[
  ["januari", "january", "januar", "jan"],
  ["februari", "february", "februar", "feb"],
  ["maart", "march", "märz", "maerz", "mrt", "mar", "mär"],
  ["april", "apr"],
  ["mei", "may", "mai"],
  ["juni", "june", "jun"],
  ["juli", "july", "jul"],
  ["augustus", "august", "aug"],
  ["september", "sept", "sep"],
  ["oktober", "october", "okt", "oct"],
  ["november", "nov"],
  ["december", "dezember", "dec", "dez"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const URL_RE = /https?:\/\/[^\s<>)"']+/gi;
const DATE_RES: { re: RegExp; key: (m: RegExpExecArray) => string | null }[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, key: (m) => `${+m[3]}-${+m[2]}` },
  { re: /\b(\d{1,2})[-./](\d{1,2})(?:[-./](\d{2,4}))?\b/g, key: (m) => (+m[2] >= 1 && +m[2] <= 12 && +m[1] <= 31 ? `${+m[1]}-${+m[2]}` : null) },
  { re: new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})\\.?(?:\\s+\\d{4})?(?![\\p{L}])`, "giu"), key: (m) => `${+m[1]}-${MONTHS[m[2].toLowerCase()]}` },
  { re: new RegExp(`(?<![\\p{L}])(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "giu"), key: (m) => `${+m[2]}-${MONTHS[m[1].toLowerCase()]}` },
];
const AMOUNT_RE = /(?:€|eur\b|euro\b)\s?-?\d[\d.,]*|\d[\d.,]*\s?(?:€|eur\b|euro\b|euros\b)/gi;
/** Words of letters, digits and dashes that contain at least three digits in a row: order numbers, tracking codes, invoice numbers, phone fragments. */
const REF_RE = /(?<![\w-])(?=[A-Za-z0-9-]*\d{3})[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9](?![\w-])/g;

interface Found {
  urls: string[];
  dates: { text: string; key: string }[];
  amounts: { text: string; key: string }[];
  refs: string[];
}

function amountKey(s: string): string {
  const digits = s.replace(/[^\d.,]/g, "").replace(/[.,]00$/, "").replace(/[.,]-$/, "");
  return digits.replace(/[.,]/g, "");
}

/** Pulls every checkable item out of a text, consuming each match so it isn't counted twice. */
export function extract(text: string): Found {
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      fn(m);
      return " ";
    });
  };
  const out: Found = { urls: [], dates: [], amounts: [], refs: [] };
  take(URL_RE, (m) => out.urls.push(m[0].replace(/[.,;:]+$/, "")));
  for (const { re, key } of DATE_RES) {
    take(re, (m) => {
      const k = key(m);
      if (k) out.dates.push({ text: m[0].replace(/[.,]$/, ""), key: k });
    });
  }
  take(AMOUNT_RE, (m) => out.amounts.push({ text: m[0].trim(), key: amountKey(m[0]) }));
  take(REF_RE, (m) => out.refs.push(m[0]));
  return out;
}

export function checkGrounding(draft: string, facts: Facts, emailText: string): GroundingResult {
  const factsText = Object.values(facts).join("\n");
  const fromFacts = extract(factsText);
  const fromEmail = extract(emailText);

  const allowedUrls = new Set(fromFacts.urls);
  const allowedDates = new Set([...fromFacts.dates, ...fromEmail.dates].map((d) => d.key));
  const allowedAmounts = new Set(fromFacts.amounts.map((a) => a.key));
  const allowedRefs = new Set([...fromFacts.refs, ...fromEmail.refs].map((r) => r.toUpperCase()));

  const d = extract(draft);
  const issues: GroundingIssue[] = [];
  for (const u of d.urls) if (!allowedUrls.has(u)) issues.push({ kind: "tracking", text: u });
  for (const x of d.dates) if (!allowedDates.has(x.key)) issues.push({ kind: "date", text: x.text });
  for (const a of d.amounts) if (!allowedAmounts.has(a.key)) issues.push({ kind: "amount", text: a.text });
  for (const r of d.refs) {
    if (allowedRefs.has(r.toUpperCase())) continue;
    issues.push({ kind: /[A-Za-z]{2,}\d{8,}/.test(r) ? "tracking" : "order_ref", text: r });
  }

  const checked = d.urls.length + d.dates.length + d.amounts.length + d.refs.length;
  return { ok: issues.length === 0, checked, issues };
}
