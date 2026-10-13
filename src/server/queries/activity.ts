import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { describeActivity, eventVersionLabel } from "@/domain/activity";
import type { AuditAction, Person } from "@/domain/review-types";
import { requireRequestContext } from "@/server/context/request";
import { services } from "@/server/services";
import type { TemplateActivity } from "@/server/services/activity";
import { peopleById, personOf } from "@/domain/people";
import { requireSpace } from "./spaces";

// The template's Activity tab: its audit events, newest first, each as one plain sentence. The events come from
// the service (`services().audit.activity`); this words them: an event about a version is labelled by its row as
// it is now, with its round for a review event (`eventVersionLabel`).

export interface ActivityItem {
  id: string;
  at: string;
  actor: Person | null; // null = system
  action: AuditAction | string;
  /** "v3 · Round 1" (chrome; the round only for review events, `eventVersionLabel`); null for the draft. */
  versionLabel: string | null;
  /** One plain sentence from domain/activity.ts: "Jordan Ellis started revoking v1: Wrong APR in legal notices." */
  summary: string;
}

export interface ActivityData {
  /** ISO: the backend's instant the events were read at (`asOf`); the tab says how long ago each was from it. */
  now: string;
  /** Newest first. */
  items: ActivityItem[];
}

/**
 * `/{team}/templates/{id}/activity`. Not found when the template isn't in the URL's space or isn't the viewer's
 * to see.
 */
export const getActivity = cache(
  async (spaceSlug: string, templateId: string): Promise<ActivityData> => {
    const ctx = await requireRequestContext();
    const space = await requireSpace(spaceSlug);
    const activity = await services().audit.activity(ctx, { templateId });
    // All teams holds every team's templates; a team's space only its own.
    if (
      !activity.ok ||
      (space.teamId !== null && activity.template.teamId !== space.teamId)
    )
      notFound();
    return activityData(activity);
  },
);

/** The Activity tab from the service's facts: one sentence per event, its version's label, its actor. */
export function activityData(activity: TemplateActivity): ActivityData {
  const people = peopleById(activity.people);
  return {
    now: activity.asOf,
    items: activity.events.map((e) => {
      const actor = e.actorId ? personOf(people, e.actorId) : null;
      return {
        id: e.id,
        at: e.at,
        actor,
        action: e.action,
        versionLabel: eventVersionLabel(e.action, e.version),
        summary: describeActivity(
          { action: e.action, details: e.details, version: e.version },
          actor,
        ),
      };
    }),
  };
}
