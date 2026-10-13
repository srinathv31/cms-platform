import "server-only";
import { sunsetInstant } from "@/domain/business-zone";
import { isCalendarDay } from "@/domain/dates";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import {
  setSunset as setSunsetTransition,
  sunsetPassed,
} from "@/domain/lifecycle/sunset";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { readBusinessZone } from "@/server/business-zone";
import { writeEffects } from "@/server/effects";
import { notMoved } from "../not-moved";
import type { ReviewService } from "../review";
import type { Changed } from "../types";
import { check, refuse, runCommand } from "./command";
import {
  activeVersion,
  effectContext,
  findVersion,
  loadVersion,
  updateVersion,
} from "./version-rows";

// The review lifecycle on this app's own database (src/server/services/review.ts says what each command
// promises). Each runs on the command kit (./command.ts): `authorize` reads the version only to learn its
// team and checks the permission; the one transaction re-reads it, asks the domain transition
// (src/domain/lifecycle), writes the changes with a compare-and-set on state and rev, and writes the
// transition's effects through src/server/effects.ts.

export const localReview: ReviewService = {
  setSunset: (ctx, input) =>
    runCommand(ctx, input, {
      authorize: async ({ ctx, input }) => {
        const found = await findVersion(input.templateId, input.versionNumber);
        check(ctx.viewer, "version.setSunset", {
          teamId: found?.teamId ?? null,
        });
        if (!found) refuse(REQUEST_REFUSALS.versionGone);
        if (!isCalendarDay(input.sunsetDay))
          refuse(REQUEST_REFUSALS.invalidDate);
        return found;
      },
      transaction: async (
        tx,
        { ctx, input, found },
      ): Promise<ActionResult<Changed>> => {
        const { viewer, now: at } = ctx;
        const version = await loadVersion(tx, found, input.versionNumber);
        const zone = await readBusinessZone(tx);
        // The day it already has, while it can still be moved, is a double click: nothing to write.
        const unchanged =
          version.sunsetAt?.getTime() ===
          sunsetInstant(input.sunsetDay, zone).getTime();
        if (
          version.state === "superseded" &&
          unchanged &&
          !sunsetPassed(version, at)
        )
          return { ok: true, changed: false };
        const active = await activeVersion(tx, found.templateId);

        const outcome = setSunsetTransition({
          version,
          actorId: viewer.userId,
          now: at,
          sunsetDay: input.sunsetDay,
          zone,
          activeNumber: active?.number ?? null,
          templateName: version.name,
          contractChanges: active?.contractChanges ?? null,
        });
        if (!outcome.ok) refuse(outcome);

        await updateVersion(
          tx,
          version,
          outcome.changes,
          at,
          REFUSALS.sunsetNotSuperseded,
        );
        await writeEffects(
          tx,
          outcome.effects,
          effectContext(viewer, found, version.id, at),
        );
        return { ok: true, changed: true };
      },
    }),

  submit: notMoved("review.submit"),
  requestChanges: notMoved("review.requestChanges"),
  approve: notMoved("review.approve"),
  startRevoke: notMoved("review.startRevoke"),
  confirmRevoke: notMoved("review.confirmRevoke"),
  cancelRevoke: notMoved("review.cancelRevoke"),
  queue: notMoved("review.queue"),
  badgeCount: notMoved("review.badgeCount"),
  screen: notMoved("review.screen"),
  submitSummary: notMoved("review.submitSummary"),
};
