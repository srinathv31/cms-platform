// How an implementation stops a command with a refusal. Both implementations (local and fake) run a command
// as steps that may refuse at any point; `refuse()` throws a `RefusalError`, which undoes what the command
// wrote (a rolled-back transaction, or the fake's undo log) and becomes the answer, `{ ok: false, code,
// reason }`. Anything else thrown is a bug and propagates.
//
// The domain's own `refuse` (src/domain/refusals.ts) builds the value a rule returns; this one throws it.

import { can } from "@/domain/permissions";
import type { Refusal, Refused } from "@/domain/refusals";
import type {
  Action,
  PermissionResource,
  PermissionResult,
  Viewer,
} from "@/domain/types";

/** A refusal raised in a command's steps: what it wrote is undone, and it becomes the answer. */
export class RefusalError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason);
    this.name = "RefusalError";
  }
}

/** Stops the command with this refusal as its answer. */
export function refuse(refusal: Refusal): never {
  throw new RefusalError(refusal);
}

/** A permission decided by a domain rule (`canComment`, …): refused, it stops the command with its reason. */
export function permit(result: PermissionResult): void {
  if (!result.ok) refuse(result);
}

/** `can()` for the action on the resource: refused, it stops the command with its reason. */
export function check(
  viewer: Viewer,
  action: Action,
  resource: PermissionResource,
): void {
  permit(can(viewer, action, resource));
}

/** The answer a caught error makes: a `RefusalError` as its refusal; anything else is rethrown. */
export function answerFor(error: unknown): Refused {
  if (error instanceof RefusalError)
    return {
      ok: false,
      code: error.refusal.code,
      reason: error.refusal.reason,
    };
  throw error;
}
