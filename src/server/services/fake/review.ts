import { sunsetInstant } from "@/domain/business-zone";
import { isCalendarDay } from "@/domain/dates";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import {
  setSunset as setSunsetTransition,
  sunsetPassed,
} from "@/domain/lifecycle/sunset";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { notMoved } from "../not-moved";
import { answerFor, check, refuse } from "../refuse";
import type { ReviewService } from "../review";
import type { Changed } from "../types";
import { writeFakeEffects } from "./effects";
import { activeVersion, businessZone, findRound, templateById } from "./rows";
import type { FakeStore } from "./store";

// The review lifecycle in memory: the same steps as the local implementation (services/local/review.ts) in the
// same order, the same domain transitions, and the writes into the fake's state. A refusal undoes what the
// command wrote (`FakeStore.command`).

export function fakeReview(store: FakeStore): ReviewService {
  return {
    async setSunset(ctx, input) {
      try {
        return store.command((tx): ActionResult<Changed> => {
          const { state } = tx;
          const template = templateById(state, input.templateId);
          const version = template
            ? findRound(state, template.id, input.versionNumber)
            : undefined;
          check(ctx.viewer, "version.setSunset", {
            teamId: version ? template!.teamId : null,
          });
          if (!template || !version) refuse(REQUEST_REFUSALS.versionGone);
          if (!isCalendarDay(input.sunsetDay))
            refuse(REQUEST_REFUSALS.invalidDate);

          const at = ctx.now;
          const zone = businessZone(state);
          // The day it already has, while it can still be moved, is a double click: nothing to write.
          if (
            version.state === "superseded" &&
            version.sunsetAt?.getTime() ===
              sunsetInstant(input.sunsetDay, zone).getTime() &&
            !sunsetPassed(version, at)
          )
            return { ok: true, changed: false };
          const active = activeVersion(state, template.id);

          const outcome = setSunsetTransition({
            version,
            actorId: ctx.viewer.userId,
            now: at,
            sunsetDay: input.sunsetDay,
            zone,
            activeNumber: active?.number ?? null,
            templateName: version.name,
            contractChanges: active?.contractChanges ?? null,
          });
          if (!outcome.ok) refuse(outcome);

          // The compare-and-set: still in the state it was read in (nothing can interleave here).
          if (version.state !== "superseded")
            refuse(REFUSALS.sunsetNotSuperseded);
          tx.update("versions", version, {
            ...outcome.changes,
            rev: version.rev + 1,
            updatedAt: at,
          });
          writeFakeEffects(tx, outcome.effects, {
            at,
            actorId: ctx.viewer.userId,
            teamId: template.teamId,
            templateId: template.id,
            versionId: version.id,
          });
          return { ok: true, changed: true };
        });
      } catch (error) {
        return answerFor(error);
      }
    },

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
