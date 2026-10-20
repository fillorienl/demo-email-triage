/** Date helpers. All demo dates are plain ISO days (YYYY-MM-DD) in Dutch time. */
import type { Lang } from "./types";

const TZ = "Europe/Amsterdam";

export function todayIso(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parse(iso: string): Date {
  return new Date(iso + "T12:00:00Z");
}

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Moves forward (or back, for negative n) by working days, skipping weekends. */
export function addWorkdays(iso: string, n: number): string {
  const step = n < 0 ? -1 : 1;
  let d = iso;
  let left = Math.abs(n);
  while (left > 0) {
    d = addDays(d, step);
    const wd = parse(d).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parse(toIso).getTime() - parse(fromIso).getTime()) / 86_400_000);
}

const LOCALE: Record<Lang, string> = { nl: "nl-NL", en: "en-GB", de: "de-DE" };

/**
 * The one way a date is written in a draft: weekday, day and month, in the customer's language.
 * nl "donderdag 22 oktober", en "Thursday 22 October", de "Donnerstag, 22. Oktober".
 * The grounding check relies on drafts copying these strings.
 */
export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(parse(iso));
}

/** Short form for the UI, e.g. "22 Oct". */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(parse(iso));
}
