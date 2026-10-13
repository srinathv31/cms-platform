import "server-only";

import { z } from "zod";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { SubmitFacts, SubmitSummary } from "@/domain/submit-types";
import { CHANNELS } from "@/domain/types";
import { listSets } from "@/editor/model/sample-sets";
import type { RequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import { refusal, type ReadResult } from "@/server/services/results";

// A read, not a change: what the submit dialog lists, taken from the saved draft, served by
// GET /api/templates/[templateId]/submit-summary. The dialog sits in the tab bar, a separate subtree
// from the editor, so it can't see the live variables. It asks for them here, after the pending
// autosave has gone out (`session.flush()`), which makes the saved draft the live one, and again from
// its "Refresh summary". The draft's `rev` comes with it: submit sends it back, and is refused if the
// draft has changed since. Read-only, so nothing is written, audited or refreshed.
//
// The backend answers the facts (`ReviewService.submitSummary`); this lays them out for the dialog
// (`submitSummaryOf`).

const Input = z.object({ templateId: z.string().min(1).max(64) });

export async function getSubmitSummary(
  ctx: RequestContext,
  input: { templateId: string },
): Promise<ReadResult<{ summary: SubmitSummary }>> {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return refusal(400, REQUEST_REFUSALS.templateUnavailable);
  const facts = await services().review.submitSummary(ctx, parsed.data);
  if (!facts.ok) return facts;
  return { ok: true, summary: submitSummaryOf(facts) };
}

/**
 * The dialog's summary from the backend's facts: the channels in the content type's order, and the names of
 * every sample data set, the generated defaults first (`listSets`, whose default names are the BFF's words),
 * listed on the day the backend read the draft (`asOf`).
 */
export function submitSummaryOf(facts: SubmitFacts): SubmitSummary {
  return {
    templateId: facts.templateId,
    rev: facts.rev,
    number: facts.number,
    round: facts.round,
    name: facts.name,
    channels: CHANNELS.filter((channel) => facts.channels.includes(channel)),
    sampleSetNames: listSets(
      facts.sampleSets,
      facts.variables,
      facts.asOf.slice(0, 10),
    ).map((set) => set.name),
    variables: facts.variables,
    baseline: facts.baseline,
  };
}
