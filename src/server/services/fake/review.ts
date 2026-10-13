import { isCalendarDay } from "@/domain/dates";
import {
  setSunset as setSunsetTransition,
  sunsetUnchanged,
} from "@/domain/lifecycle/sunset";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { ActionResult } from "@/domain/review-types";
import { notMoved } from "../not-moved";
import { answerFor, check, refuse } from "../refuse";
import type { ReviewService } from "../review";
import type { Changed } from "../types";
import { writeFakeEffects } from "./effects";
import type { FakeDeps } from "./index";
import {
  activeVersion,
  businessZone,
  compareAndSetVersion,
  findRound,
  templateById,
} from "./rows";

// The review lifecycle in memory: the same steps as the local implementation (services/local/review.ts) in the
// same order, the same domain rules, and the writes into the fake's state. The clock is read before the
// command, which then runs synchronously (`FakeStore.command`); a refusal undoes what it wrote.

export function fakeReview(deps: FakeDeps): ReviewService {
  const { store, clock, hooks } = deps;
  return {
    async setSunset(ctx, input) {
      const now = await clock();
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

          const read = { ...version };
          const zone = businessZone(state);
          if (sunsetUnchanged(version, input.sunsetDay, zone, now))
            return { ok: true, changed: false };
          const active = activeVersion(state, template.id);

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

          compareAndSetVersion(tx, version, read, outcome.changes, now, hooks);
          writeFakeEffects(tx, outcome.effects, {
            at: now,
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
