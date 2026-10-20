/**
 * AI provider switch, ported from the invoice intake demo for Workers:
 * Claude (default) or Mistral (EU-hosted). Text only, so no PDF handling.
 * Pick with LLM_PROVIDER: anthropic | mistral.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Lang, ReadResult, RouteResult } from "../../core/types";
import type { Env } from "../env";
import { DRAFT_SYSTEM, draftUserMessage, parseRead, READ_SCHEMA, READ_SYSTEM, readUserMessage } from "./prompts";

export type Provider = "anthropic" | "mistral";

export interface EmailInput {
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  attachments: string[];
}

export function provider(env: Env): Provider {
  const p = (env.LLM_PROVIDER || "anthropic").toLowerCase();
  if (p === "anthropic" || p === "mistral") return p;
  throw new Error(`Unknown LLM_PROVIDER "${p}". Use anthropic or mistral.`);
}

export function modelLabel(env: Env): string {
  if (env.AI_MODE === "fixture") return "test fixtures (no AI)";
  return provider(env) === "mistral" ? `Mistral · ${env.MISTRAL_MODEL}` : `Claude · ${env.ANTHROPIC_MODEL}`;
}

/** Stable id used to key the seed cache: a different model gets its own cached results. */
export function modelKey(env: Env): string {
  return provider(env) === "mistral" ? `mistral/${env.MISTRAL_MODEL}` : `anthropic/${env.ANTHROPIC_MODEL}`;
}

export interface AiOut<T> {
  value: T;
  model: string;
}

export async function aiRead(env: Env, email: EmailInput): Promise<AiOut<ReadResult>> {
  return provider(env) === "mistral" ? mistralRead(env, email) : anthropicRead(env, email);
}

export async function aiDraft(
  env: Env,
  email: EmailInput,
  facts: Record<string, string>,
  lang: Lang,
  kind: Exclude<RouteResult["draft"], "none">,
): Promise<AiOut<string>> {
  const user = draftUserMessage(email, facts, lang, kind);
  return provider(env) === "mistral" ? mistralText(env, DRAFT_SYSTEM, user) : anthropicText(env, DRAFT_SYSTEM, user);
}

// ---------- Claude ----------

function anthropic(env: Env) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Add it with `wrangler secret put ANTHROPIC_API_KEY` (or .dev.vars locally).");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
}

function textOf(res: Anthropic.Beta.BetaMessage): string {
  if (res.stop_reason === "refusal") throw new Error("The model declined this email.");
  if (res.stop_reason === "max_tokens") throw new Error("The model's answer was cut off (max_tokens).");
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

async function anthropicRead(env: Env, email: EmailInput): Promise<AiOut<ReadResult>> {
  const res = await anthropic(env).beta.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: READ_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: READ_SCHEMA } },
    messages: [{ role: "user", content: readUserMessage(email) }],
  });
  return { value: parseRead(textOf(res)), model: res.model };
}

async function anthropicText(env: Env, system: string, user: string): Promise<AiOut<string>> {
  const res = await anthropic(env).beta.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: user }],
  });
  return { value: textOf(res).trim(), model: res.model };
}

// ---------- Mistral (EU) ----------

async function mistralChat(env: Env, body: Record<string, unknown>): Promise<{ text: string; model: string }> {
  if (!env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is not set. Add it with `wrangler secret put MISTRAL_API_KEY` (or .dev.vars locally).");
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MISTRAL_API_KEY}` },
    body: JSON.stringify({ model: env.MISTRAL_MODEL, ...body }),
  });
  if (!res.ok) throw new Error(`Mistral returned ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { model: string; choices: { message: { content: string }; finish_reason: string }[] };
  const choice = json.choices[0];
  if (choice.finish_reason === "length") throw new Error("Mistral's answer was cut off (max_tokens).");
  return { text: choice.message.content, model: json.model };
}

async function mistralRead(env: Env, email: EmailInput): Promise<AiOut<ReadResult>> {
  const { text, model } = await mistralChat(env, {
    max_tokens: 1500,
    temperature: 0,
    response_format: { type: "json_schema", json_schema: { name: "email_reading", schema: READ_SCHEMA, strict: true } },
    messages: [
      { role: "system", content: READ_SYSTEM },
      { role: "user", content: readUserMessage(email) },
    ],
  });
  return { value: parseRead(text), model };
}

async function mistralText(env: Env, system: string, user: string): Promise<AiOut<string>> {
  const { text, model } = await mistralChat(env, {
    max_tokens: 1500,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return { value: text.trim(), model };
}
