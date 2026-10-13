import "server-only";
import { isCalendarDay } from "@/domain/dates";
import {
  setSunset as setSunsetTransition,
  sunsetUnchanged,
} from "@/domain/lifecycle/sunset";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { readBusinessZone } from "@/server/business-zone";
import { writeEffects } from "@/server/effects";
import {
  activeVersion,
  effectContext,
  findVersion,
  loadVersion,
  updateVersion,
} from "@/server/version-rows";
import { notMoved } from "../not-moved";
import type { ReviewService } from "../review";
import type { Changed } from "../types";
import { check, refuse, runCommand, type LocalDeps } from "./command";

// The review lifecycle on this app's own database (src/server/services/review.ts says what each command
// promises). Each runs on the command kit (./command.ts): `authorize` reads the version only to learn its
// team and checks the permission; the one transaction re-reads it, asks the domain (src/domain/lifecycle),
// writes the changes with a compare-and-set on state and rev, and writes the transition's effects through
// src/server/effects.ts, all dated by the backend's clock.

export function localReview(deps: LocalDeps): ReviewService {
  return {
    setSunset: (ctx, input) =>
      runCommand(deps, ctx, input, {
        authorize: async ({ ctx, input }) => {
          const found = await findVersion(
            input.templateId,
            input.versionNumber,
          );
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
          { ctx, input, found, now },
        ): Promise<ActionResult<Changed>> => {
          const version = await loadVersion(tx, found, input.versionNumber);
          const zone = await readBusinessZone(tx);
          if (sunsetUnchanged(version, input.sunsetDay, zone, now))
            return { ok: true, changed: false };
          const active = await activeVersion(tx, found.templateId);

          const outcome = setSunsetTransition({
            version,
            actorId: ctx.viewer.userId,
            now,
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
            now,
            REQUEST_REFUSALS.versionChanged,
            deps.hooks,
          );
          await writeEffects(
            tx,
            outcome.effects,
            effectContext(ctx.viewer, found, version.id, now),
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
}
