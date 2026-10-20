/**
 * Cached and fixture drafts are stored as templates: every fact value in the text is
 * replaced by {{key}}. On replay the placeholders are filled from today's facts, so a
 * draft cached last week still shows this week's dates.
 * {{^key}} means the value starts a sentence and is capitalised.
 */
import type { Facts } from "./types";

const MIN_LEN = 4;

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toTemplate(draft: string, facts: Facts): string {
  const entries = Object.entries(facts)
    .filter(([, v]) => v.length >= MIN_LEN)
    .sort((a, b) => b[1].length - a[1].length);
  let out = draft;
  for (const [key, value] of entries) {
    out = out.replace(new RegExp(escape(value), "gi"), (m) => {
      const capitalised = m[0] !== value[0] && m[0] === m[0].toUpperCase();
      return `{{${capitalised ? "^" : ""}${key}}}`;
    });
  }
  return out;
}

/** Returns the filled text and any placeholders today's facts could not fill. */
export function fillTemplate(template: string, facts: Facts): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{\{(\^?)([a-z0-9_]+)\}\}/g, (m, cap: string, key: string) => {
    const v = facts[key];
    if (v === undefined) {
      missing.push(key);
      return m;
    }
    return cap ? v.charAt(0).toUpperCase() + v.slice(1) : v;
  });
  return { text, missing };
}
