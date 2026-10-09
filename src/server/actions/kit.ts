import "server-only";
import type { z } from "zod";
import { can } from "@/domain/permissions";
import { REQUEST_REFUSALS, type Refusal } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import type { Action, PermissionResource, PermissionResult, Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import { db } from "@/server/db/client";
import { inTransaction, type Tx } from "@/server/effects";
import { getViewer } from "@/server/viewer";

// The server action kit: the one shape every mutation in this folder has (AGENTS.md, "Server code"),
// written once. An action declares its steps and `serverAction` runs them in this order:
//
//   1. `getViewer()`.
//   2. The input, parsed with zod. Input that doesn't parse is refused: `invalid_input`, or the
//      action's own refusal (`invalid`).
//   3. `authorize`: read what the input names, outside any transaction and only to learn whom to
//      check (its team, its people), then check the permission: `check()` for a `can()` action,
//      `permit()` for a domain rule. A record that doesn't exist is refused like a forbidden one. Then
//      refuse what the request can't be (the record is gone, the note is too long). It returns what
//      the transaction needs.
//   4. `now()`, once.
//   5. `transaction`: ONE `inTransaction`, retried when SQLite is busy. Re-read, ask the domain, write
//      with a compare-and-set, and write the effects (audit rows, notifications, consumer notices).
//   6. `after`, only when the transaction committed with `ok`: `revalidatePath()`, `refresh()`, and
//      `redirect()` last.
//
// A refusal is `refuse(refusal)` in steps 3 and 5 (or a transaction returning `{ ok: false, … }`): it
// stops the action, rolls the transaction back, and becomes the answer, `{ ok: false, code, reason }`.
// Anything else thrown is a bug: it propagates, and the browser shows its own failure sentence. Next's
// `redirect()` in `after` propagates too, as Next expects.
//
// `refuse` here throws; the domain's `refuse` (domain/refusals.ts) builds the result a rule returns.
// Not "use server": that would make every export here a public endpoint.

/** A refusal raised in an action's steps: it rolls the transaction back and becomes the answer. */
export class RefusalError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason);
    this.name = "RefusalError";
  }
}

/** Stops the action with this refusal as its answer. Inside the transaction, nothing it wrote is kept. */
export function refuse(refusal: Refusal): never {
  throw new RefusalError(refusal);
}

/** A permission decided by a domain rule (`canComment`, …): refused, it stops the action with its reason. */
export function permit(result: PermissionResult): void {
  if (!result.ok) refuse(result);
}

/** `can()` for the action on the resource: refused, it stops the action with its reason. */
export function check(viewer: Viewer, action: Action, resource: PermissionResource): void {
  permit(can(viewer, action, resource));
}

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

export interface ActionSteps<I, F, T extends object> {
  /** The input's schema. */
  input: z.ZodType<I>;
  /** What input that doesn't parse answers. Without it, `invalid_input` with its plain sentence. */
  invalid?: Refusal | ((error: z.ZodError) => Refusal);
  /** Reads what the input names (outside the transaction), checks the permission, and returns what the transaction needs. */
  authorize: (ctx: ActionContext<I>) => F | Promise<F>;
  /** The one transaction: re-read, ask the domain, compare-and-set, effects. Read and write through `tx`. */
  transaction: (tx: Tx, ctx: CommitContext<I, F>) => Promise<ActionResult<T>>;
  /** After the transaction committed with `ok`: revalidate, refresh, and redirect last. */
  after?: (result: { ok: true } & T, ctx: CommitContext<I, F>) => void | Promise<void>;
}

/** Runs a server action's steps (see the top of this file) and answers with its `ActionResult`. */
export async function serverAction<I, F, T extends object = Record<never, never>>(
  raw: unknown,
  steps: ActionSteps<I, F, T>,
): Promise<ActionResult<T>> {
  try {
    const viewer = await getViewer();
    const parsed = steps.input.safeParse(raw);
    if (!parsed.success) {
      const { invalid } = steps;
      refuse(typeof invalid === "function" ? invalid(parsed.error) : (invalid ?? REQUEST_REFUSALS.invalidInput()));
    }
    const input = parsed.data;
    const found = await steps.authorize({ viewer, input });
    const ctx: CommitContext<I, F> = { viewer, input, found, now: await now() };
    const result = await inTransaction(db, async (tx) => {
      const answer = await steps.transaction(tx, ctx);
      // A refusal returned rather than raised rolls back the same way.
      if (!answer.ok) refuse(answer);
      return answer;
    });
    await steps.after?.(result, ctx);
    return result;
  } catch (error) {
    if (error instanceof RefusalError) return { ok: false, code: error.refusal.code, reason: error.refusal.reason };
    throw error;
  }
}
