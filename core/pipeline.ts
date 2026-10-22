/** The code half of the pipeline: lookup, routing and the facts block. No AI, no storage. */
import { buildFacts, replyLanguage } from "./facts";
import { checkGrounding } from "./grounding";
import { lookup, type OrderSystem, type ReturnPolicy } from "./lookup";
import { route } from "./rules";
import type { Facts, GroundingResult, Lang, LookupContext, ReadResult, RouteResult } from "./types";

export interface DecideInput {
  read: ReadResult;
  fromEmail: string;
  emailText: string;
  today: string;
  rmaNumber: string;
  signature: Record<Lang, string>;
  returnAddress: string;
  policy: ReturnPolicy & { text: string };
}

export interface Decision {
  ctx: LookupContext;
  routed: RouteResult;
  lang: Lang;
  facts: Facts;
}

export async function decide(input: DecideInput, os: OrderSystem): Promise<Decision> {
  const ctx = await lookup(input.read, input.fromEmail, input.emailText, os, input.today, input.policy);
  const routed = route(input.read, ctx);
  const lang = replyLanguage(input.read, ctx);
  const approvedReturn = routed.ruleId === "ready_return" || routed.ruleId === "look_return_unconfirmed";
  const facts = buildFacts(input.read, ctx, routed, lang, {
    rmaNumber: approvedReturn ? input.rmaNumber : undefined,
    returnAddress: input.returnAddress,
    policyText: input.policy.text,
  });
  facts.signature = input.signature[lang];
  return { ctx, routed, lang, facts };
}

/** After drafting: a failed grounding check drops a Ready email to Needs a look. */
export function applyGrounding(routed: RouteResult, draft: string, facts: Facts, emailText: string): { routed: RouteResult; grounding: GroundingResult } {
  const grounding = checkGrounding(draft, facts, emailText);
  if (!grounding.ok && routed.lane === "ready") {
    return {
      grounding,
      routed: { ...routed, lane: "needs_look", ruleId: "look_grounding_failed", reason: `Draft mentions something not in the facts: ${grounding.issues.map((i) => i.text).join(", ")}` },
    };
  }
  return { routed, grounding };
}

/** After drafting: a question from the AI to the reviewer means a person looks before anything is sent. */
export function applyReviewerNote(routed: RouteResult, note: string | null): RouteResult {
  if (!note || routed.lane !== "ready") return routed;
  return { ...routed, lane: "needs_look", ruleId: "look_reviewer_note", reason: "The AI has a question for the reviewer before this goes out" };
}
