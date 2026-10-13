import "server-only";
import type { z } from "zod";
import { REQUEST_REFUSALS, type Refusal } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { Viewer } from "@/domain/types";
import {
  requestContextOrRefusal,
  type RequestContext,
} from "@/server/context/request";
import { db } from "@/server/db/client";
import { inTransaction, type Tx } from "@/server/effects";
import { answerFor, refuse } from "@/server/services/refuse";

// The server action kit: the one shape every mutation in this folder has (AGENTS.md, "Server code"), written
// once. An action declares its steps and `serverAction` runs them in this order:
//
//   1. The request context (src/server/context/request.ts): the viewer and the instant, read once. Nobody
//      signed in is refused (`signed_out`) before anything else.
//   2. The input, parsed with zod. Input that doesn't parse is refused: `invalid_input`, or the action's own
//      refusal (`invalid`).
//   3. `call`: the service (src/server/services), with the context and the parsed input. The backend checks
//      the permission, asks the domain, writes with a compare-and-set and writes the effects, or refuses;
//      the BFF decides nothing itself (decision 0070).
//   4. `after`, only when the service answered `ok`: `revalidatePath()`, `refresh()`, and `redirect()` last.
//
// A refusal is the service's `{ ok: false, code, reason }`, answered as it is. Anything thrown is a bug: it
// propagates, and the browser shows its own failure sentence. Next's `redirect()` in `after` propagates too,
// as Next expects.
//
// Actions that haven't moved behind the services yet still declare `authorize` and `transaction` instead of
// `call` (`ActionSteps` below): the kit runs those against the database itself, with the same order and the
// same refusal handling as the local implementation's command kit (src/server/services/local/command.ts).
//
// Not "use server": that would make every export here a public endpoint.

export { check, permit, refuse } from "@/server/services/refuse";

/** Who is acting, and the input as parsed. */
export interface ActionContext<I> {
  viewer: Viewer;
  input: I;
}

/** What the transaction and `after` see: the context, what `authorize` found, and the clock, read once. */
export interface CommitContext<I, F> extends ActionContext<I> {
  found: F;
  now: Date;
}

interface InputSteps<I> {
  /** The input's schema. */
  input: z.ZodType<I>;
  /** What input that doesn't parse answers. Without it, `invalid_input` with its plain sentence. */
  invalid?: Refusal | ((error: z.ZodError) => Refusal);
}

/** An action behind the services: parse, then call the service. */
export interface ServiceSteps<I, T extends object> extends InputSteps<I> {
  /** Asks the service, with the request context. */
  call: (ctx: RequestContext, input: I) => Promise<ActionResult<T>>;
  /** After the service answered `ok`: revalidate, refresh, and redirect last. */
  after?: (
    result: { ok: true } & T,
    c: { ctx: RequestContext; input: I },
  ) => void | Promise<void>;
}

/** An action that hasn't moved behind the services: it reads and writes the database itself. */
export interface ActionSteps<I, F, T extends object> extends InputSteps<I> {
  /** Reads what the input names (outside the transaction), checks the permission, and returns what the transaction needs. */
  authorize: (ctx: ActionContext<I>) => F | Promise<F>;
  /** The one transaction: re-read, ask the domain, compare-and-set, effects. Read and write through `tx`. */
  transaction: (tx: Tx, ctx: CommitContext<I, F>) => Promise<ActionResult<T>>;
  /** After the transaction committed with `ok`: revalidate, refresh, and redirect last. */
  after?: (
    result: { ok: true } & T,
    ctx: CommitContext<I, F>,
  ) => void | Promise<void>;
}

/** Runs a server action's steps (see the top of this file) and answers with its `ActionResult`. */
export async function serverAction<I, T extends object = Record<never, never>>(
  raw: unknown,
  steps: ServiceSteps<I, T>,
): Promise<ActionResult<T>>;
export async function serverAction<
  I,
  F,
  T extends object = Record<never, never>,
>(raw: unknown, steps: ActionSteps<I, F, T>): Promise<ActionResult<T>>;
export async function serverAction<I, F, T extends object>(
  raw: unknown,
  steps: ServiceSteps<I, T> | ActionSteps<I, F, T>,
): Promise<ActionResult<T>> {
  try {
    const context = await requestContextOrRefusal();
    if (!context.ok) return context;
    const ctx = context.context;
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

    if ("call" in steps) {
      const result = await steps.call(ctx, input);
      if (result.ok) await steps.after?.(result, { ctx, input });
      return result;
    }

    const found = await steps.authorize({ viewer: ctx.viewer, input });
    const commit: CommitContext<I, F> = {
      viewer: ctx.viewer,
      input,
      found,
      now: ctx.now,
    };
    const result = await inTransaction(db, async (tx) => {
      const answer = await steps.transaction(tx, commit);
      // A refusal returned rather than raised rolls back the same way.
      if (!answer.ok) refuse(answer);
      return answer;
    });
    await steps.after?.(result, commit);
    return result;
  } catch (error) {
    return answerFor(error);
  }
}
