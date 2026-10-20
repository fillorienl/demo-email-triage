/**
 * Processes one email: AI reads → code decides → AI drafts from facts → grounding check.
 * Seed emails replay cached AI results when available; typed and live emails always use live AI.
 */
import { todayIso } from "../core/dates";
import { applyGrounding, decide } from "../core/pipeline";
import { fillTemplate, toTemplate } from "../core/template";
import type { AiMode, GroundingResult, ReadResult, RouteResult } from "../core/types";
import { seedExpected } from "../seed/expected";
import { mockOrderSystem } from "../seed/mockOrderSystem";
import { COMPANY, RETURN_POLICY } from "../seed/reference";
import { aiDraft, aiRead, modelKey, type EmailInput } from "./ai/providers";
import type { Env } from "./env";
import { bump, claimEmail, counter, failEmail, getSeedCache, nextRmaNumber, putSeedCache, saveTriage, type EmailRow } from "./store";

export class CapReached extends Error {}

const SIGNATURE = {
  nl: `${COMPANY.serviceSignature.nl}\n${COMPANY.name}`,
  en: `${COMPANY.serviceSignature.en}\n${COMPANY.name}`,
  de: `${COMPANY.serviceSignature.de}\n${COMPANY.name}`,
};

function emailInput(row: EmailRow): EmailInput {
  return { fromName: row.from_name, fromEmail: row.from_email, subject: row.subject, body: row.body, attachments: JSON.parse(row.attachments) };
}

/** Checks and counts AI usage. Seed cache misses only count against the global cap. */
async function reserveAi(env: Env, sandboxId: string, calls: number, perSandbox: boolean) {
  const global = await counter(env.DB, "global_ai_calls");
  if (global + calls > Number(env.CAP_GLOBAL_AI_CALLS_PER_DAY)) {
    throw new CapReached("The demo's daily AI budget is used up. Seed emails still work from cached results; live emails work again tomorrow.");
  }
  if (perSandbox) {
    const mine = await counter(env.DB, `sandbox_live:${sandboxId}`);
    if (mine >= Number(env.CAP_SANDBOX_LIVE_PER_DAY)) {
      throw new CapReached(`You've used today's ${env.CAP_SANDBOX_LIVE_PER_DAY} live AI emails for this sandbox. Try again tomorrow, or reset the demo to replay the seed inbox.`);
    }
  }
}

const laneName = (l: string) => l.replace("_", " ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processEmail(env: Env, sandboxId: string, emailId: string): Promise<{ ok: true } | { ok: false; error: string; cap?: boolean }> {
  const row = await claimEmail(env.DB, sandboxId, emailId);
  if (!row) return { ok: true }; // already processed or being processed

  const started = Date.now();
  try {
    const email = emailInput(row);
    const emailText = `${row.subject}\n${row.body}`;
    const today = todayIso();
    const fixture = env.AI_MODE === "fixture";
    const seed = row.seed_no ? seedExpected(row.seed_no) : null;
    const mk = modelKey(env);

    // ---- 1. AI reads
    let read: ReadResult;
    let aiMode: AiMode;
    let model: string | null = null;
    let cachedTemplate: string | null = null;
    let cacheMiss = false;

    if (fixture) {
      if (!seed) throw new Error("Offline test mode only covers the 11 seed emails. Set AI_MODE=live to triage other emails.");
      read = seed.read;
      aiMode = "fixture";
      cachedTemplate = seed.draft;
    } else {
      const cached = row.seed_no ? await getSeedCache(env.DB, row.seed_no, mk) : null;
      if (cached) {
        read = JSON.parse(cached.read_json);
        aiMode = "cached";
        model = cached.model;
        cachedTemplate = cached.draft_template;
        await sleep(400 + Math.random() * 700);
      } else {
        await reserveAi(env, sandboxId, 2, !row.seed_no);
        const out = await aiRead(env, email);
        await bump(env.DB, "global_ai_calls");
        if (!row.seed_no) await bump(env.DB, `sandbox_live:${sandboxId}`);
        read = out.value;
        model = out.model;
        aiMode = "live";
        cacheMiss = !!row.seed_no;
      }
    }

    // ---- 2. Code decides
    const rmaNumber = read.category === "return_request" ? await nextRmaNumber(env.DB, sandboxId) : "";
    const d = await decide(
      {
        read,
        fromEmail: row.from_email,
        emailText,
        today,
        rmaNumber,
        signature: SIGNATURE,
        returnAddress: COMPANY.address,
        policy: RETURN_POLICY,
      },
      mockOrderSystem(today),
    );

    // ---- 3. AI drafts from facts (or the cached/fixture template, filled with today's facts)
    let routed: RouteResult = d.routed;
    let draft: { kind: Exclude<RouteResult["draft"], "none">; body: string; grounding: GroundingResult } | null = null;
    let draftSource: AiMode | null = null;
    if (d.routed.draft !== "none") {
      let body: string | null = null;
      if (cachedTemplate) {
        const filled = fillTemplate(cachedTemplate, d.facts);
        if (!filled.missing.length) {
          body = filled.text;
          draftSource = aiMode;
        }
      }
      if (body === null) {
        if (fixture) throw new Error("No fixture draft for this email.");
        if (aiMode !== "live") await reserveAi(env, sandboxId, 1, false);
        const out = await aiDraft(env, email, d.facts, d.lang, d.routed.draft);
        await bump(env.DB, "global_ai_calls");
        body = out.value;
        model = out.model;
        draftSource = "live";
      }
      // ---- 4. Grounding check
      const g = applyGrounding(d.routed, body, d.facts, emailText);
      routed = g.routed;
      draft = { kind: d.routed.draft, body, grounding: g.grounding };
    }

    // Only cache a first real run when it lands where the seed is expected to, so a bad run never gets replayed.
    if (cacheMiss && seed && routed.lane === seed.expected.lane) {
      await putSeedCache(env.DB, row.seed_no!, mk, read, draft ? toTemplate(draft.body, d.facts) : null, model);
    }

    const ctx = d.ctx;
    const auditLines: { actor: "ai" | "code"; action: string; detail?: string }[] = [
      {
        actor: "ai",
        action: aiMode === "live" ? "Read email" : aiMode === "cached" ? "Read email (cached AI result)" : "Read email (test fixture)",
        detail: `${read.category}${read.secondary_intents.length ? " + " + read.secondary_intents.join(", ") : ""}, ${read.language}, confidence ${read.confidence.toFixed(2)}`,
      },
      {
        actor: "code",
        action: "Looked up customer and order",
        detail: [ctx.customer ? `Customer ${ctx.customer.debtorId} ${ctx.customer.name}` : "Sender not on file", ctx.order ? `order ${ctx.order.id} (${ctx.orderMatch.replace(/_/g, " ")})` : "no order"].join(", "),
      },
      ...ctx.returnDecisions.map((r) => ({ actor: "code" as const, action: r.allowed ? "Return policy: allowed" : "Return policy: refused", detail: `${r.lineId}: ${r.reason}` })),
      { actor: "code", action: `Routed to ${laneName(d.routed.lane)}`, detail: `${d.routed.ruleId}: ${d.routed.reason}` },
    ];
    if (draft) {
      const kind = draft.kind === "reply" ? "reply" : `${draft.kind} reply`;
      auditLines.push(
        { actor: "ai", action: draftSource === "live" ? `Drafted ${kind}` : `Drafted ${kind} (${draftSource === "cached" ? "cached, today's facts filled in" : "test fixture"})`, detail: d.lang },
        {
          actor: "code",
          action: draft.grounding.ok ? "Grounding check passed" : "Grounding check failed",
          detail: draft.grounding.ok ? `${draft.grounding.checked} dates, numbers and links verified` : draft.grounding.issues.map((i) => `${i.kind}: ${i.text}`).join("; "),
        },
      );
      if (routed.lane !== d.routed.lane) auditLines.push({ actor: "code", action: `Moved to ${laneName(routed.lane)}`, detail: routed.reason });
    }

    await saveTriage(
      env.DB,
      sandboxId,
      row.id,
      {
        read,
        context: ctx,
        facts: d.facts,
        lane: routed.lane,
        ruleId: routed.ruleId,
        reason: routed.reason,
        routeTo: routed.routeTo,
        lang: d.lang,
        aiMode: draftSource === "live" && aiMode !== "live" ? "live" : aiMode,
        model,
        ms: Date.now() - started,
      },
      draft,
      auditLines,
    );
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failEmail(env.DB, sandboxId, row.id, message);
    return { ok: false, error: message, cap: e instanceof CapReached };
  }
}
