import "server-only";
import type { z } from "zod";
import { REQUEST_REFUSALS, type Refusal } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import {
  requestContextOrRefusal,
  type RequestContext,
} from "@/server/context/request";
import { answerFor, refuse } from "@/server/services/refuse";

// The server action kit: the one shape every mutation in this folder has (AGENTS.md, "Server code"), written
// once. An action declares its steps and `serverAction` runs them in this order:
//
//   1. The request context (src/server/context/request.ts): who is asking. Nobody signed in is refused
//      (`signed_out`) before anything else.
//   2. The input, parsed with zod. Input that doesn't parse is refused: `invalid_input`, or the action's own
//      refusal (`invalid`).
//   3. `call`: the service (src/server/services), with the context and the parsed input. The backend checks
//      the permission, reads its own clock, asks the domain, writes with a compare-and-set and writes the
//      effects, or refuses; the BFF decides nothing itself and supplies no time (decisions 0070, 0072). A
//      `call` that asks more than one service (New template reads the content type, then creates) may stop
//      with a read's refusal: `refuse(refusal)`.
//   4. `after`, only when the service answered `ok`: `revalidatePath()`, `refresh()`, and `redirect()` last.
//
// A refusal is the service's `{ ok: false, code, reason }`, answered as it is. Anything thrown is a bug or an
// outage: it propagates, and the browser shows its own failure sentence. Next's `redirect()` in `after`
// propagates too, as Next expects.
//
// Not "use server": that would make every export here a public endpoint.

export { refuse } from "@/server/services/refuse";

interface InputSteps<I> {
  /** The input's schema. */
  input: z.ZodType<I>;
  /** What input that doesn't parse answers. Without it, `invalid_input` with its plain sentence. */
  invalid?: Refusal | ((error: z.ZodError) => Refusal);
}

/** A server action's steps: parse, then call the service. */
export interface ServiceSteps<I, T extends object> extends InputSteps<I> {
  /** Asks the service, with the request context. */
  call: (ctx: RequestContext, input: I) => Promise<ActionResult<T>>;
  /** After the service answered `ok`: revalidate, refresh, and redirect last. */
  after?: (
    result: { ok: true } & T,
    c: { ctx: RequestContext; input: I },
  ) => void | Promise<void>;
}

/** Runs a server action's steps (see the top of this file) and answers with its `ActionResult`. */
export async function serverAction<I, T extends object = Record<never, never>>(
  raw: unknown,
  steps: ServiceSteps<I, T>,
): Promise<ActionResult<T>> {
  try {
    const context = await requestContextOrRefusal();
    if (!context.ok) return context;
    const { context: ctx } = context;
    const parsed = steps.input.safeParse(raw);
    if (!parsed.success) {
      const { invalid } = steps;
      refuse(
        typeof invalid === "function"
          ? invalid(parsed.error)
          : (invalid ?? REQUEST_REFUSALS.invalidInput()),
      );
    }
    const input = parsed.data;
    const result = await steps.call(ctx, input);
    if (result.ok) await steps.after?.(result, { ctx, input });
    return result;
  } catch (error) {
    return answerFor(error);
  }
}
