import "server-only";
import type { ActionResult } from "@/domain/review-types";
import { db } from "@/server/db/client";
import { inTransaction, type Tx } from "@/server/effects";
import { answerFor, refuse } from "../refuse";
import type { RequestContext } from "../types";

// The local implementation's command kit: the one shape every write behind the seam has here, written once.
// The BFF's action kit (src/server/actions/kit.ts) parses the input and reads the request context; a command
// then runs these steps, in this order:
//
//   1. `authorize`: read what the input names, outside any transaction and only to learn whom to check (its
//      team, its people), then check the permission: `check()` for a `can()` action, `permit()` for a domain
//      rule (../refuse.ts). A record that doesn't exist is refused like a forbidden one. Then refuse what the
//      request can't be (the record is gone, the note is too long). It returns what the transaction needs.
//   2. `transaction`: ONE `inTransaction`, run once (a busy database fails it). Re-read, ask the domain,
//      write with a compare-and-set, and write the effects (audit rows, notifications, consumer notices).
//
// The instant is the context's `now`, read once by the BFF for the whole request.
//
// A refusal is `refuse(refusal)` in either step (or a transaction returning `{ ok: false, … }`): it stops
// the command, rolls the transaction back, and becomes the answer, `{ ok: false, code, reason }`. Anything
// else thrown is a bug and propagates.

export { check, permit, refuse, RefusalError } from "../refuse";

/** What a command's steps see: the request and its input. */
export interface CommandContext<I> {
  ctx: RequestContext;
  input: I;
}

/** What the transaction sees: the request, the input, and what `authorize` found. */
export interface CommitContext<I, F> extends CommandContext<I> {
  found: F;
}

export interface CommandSteps<I, F, T extends object> {
  /** Reads what the input names (outside the transaction), checks the permission, and returns what the transaction needs. */
  authorize: (c: CommandContext<I>) => F | Promise<F>;
  /** The one transaction: re-read, ask the domain, compare-and-set, effects. Read and write through `tx`. */
  transaction: (tx: Tx, c: CommitContext<I, F>) => Promise<ActionResult<T>>;
}

/** Runs a command's steps (see the top of this file) and answers with its `ActionResult`. */
export async function runCommand<I, F, T extends object = Record<never, never>>(
  ctx: RequestContext,
  input: I,
  steps: CommandSteps<I, F, T>,
): Promise<ActionResult<T>> {
  try {
    const found = await steps.authorize({ ctx, input });
    return await inTransaction(db, async (tx) => {
      const answer = await steps.transaction(tx, { ctx, input, found });
      // A refusal returned rather than raised rolls back the same way.
      if (!answer.ok) refuse(answer);
      return answer;
    });
  } catch (error) {
    return answerFor(error);
  }
}
