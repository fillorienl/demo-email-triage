/**
 * Live email: service@fillorie.nl (Google Workspace) adds inbox@triage.fillorie.nl as a recipient,
 * Cloudflare Email Routing hands the message to this handler. The sandbox code in the subject
 * decides whose inbox it lands in; mail without a valid code is dropped (the mailbox keeps its copy).
 */
import PostalMime from "postal-mime";
import type { Env } from "./env";
import { processEmail } from "./process";
import { bump, insertEmail, sandboxByCode } from "./store";

export const MAX_RAW_BYTES = 256 * 1024;
export const MAX_BODY_CHARS = 8000;
const CODE_RE = /\bVEL-[A-HJ-NP-Z2-9]{3}\b/i;

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|table|h\d|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export async function handleInbound(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
  if (message.rawSize > MAX_RAW_BYTES) {
    await bump(env.DB, "inbound_too_large");
    return;
  }
  const subject = message.headers.get("subject") ?? "";
  const code = subject.match(CODE_RE)?.[0];
  const sandbox = code ? await sandboxByCode(env.DB, code) : null;
  if (!sandbox) {
    await bump(env.DB, "inbound_unmatched");
    return;
  }

  const parsed = await PostalMime.parse(message.raw);
  const text = (parsed.text?.trim() || (parsed.html ? htmlToText(parsed.html) : "")).slice(0, MAX_BODY_CHARS);
  const from = parsed.from?.address || message.from;

  const id = await insertEmail(env.DB, sandbox.id, {
    source: "live",
    fromName: parsed.from?.name || from,
    fromEmail: from,
    subject: (parsed.subject || subject).replace(CODE_RE, "").replace(/\s{2,}/g, " ").trim() || "(no subject)",
    body: text || "(empty message)",
    attachments: (parsed.attachments ?? []).map((a) => a.filename || a.mimeType).slice(0, 10),
  });
  // Stored first; if processing fails the email stays visible and "Process inbox" retries it.
  ctx.waitUntil(processEmail(env, sandbox.id, id));
}
