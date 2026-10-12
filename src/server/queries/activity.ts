import "server-only";
import { cache } from "react";
import { desc, eq, sql } from "drizzle-orm";
import { describeActivity, eventVersionLabel } from "@/domain/activity";
import type { AuditAction, Person } from "@/domain/review-types";
import { db } from "@/server/db/client";
import { auditEvents, versions } from "@/server/db/schema/ucomp";
import { getPeople, iso, personOf, requireTemplate } from "./review-shared";

// The template's Activity tab: its audit events, newest first, each as one plain sentence. An event about
// a version is labelled by its row as it is now, with its round for a review event (`eventVersionLabel`).

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

/** A template's history is short; this only guards against a runaway list. */
export const ACTIVITY_LIMIT = 500;

export const getActivity = cache(
  async (spaceSlug: string, templateId: string): Promise<ActivityItem[]> => {
    const { template } = await requireTemplate(spaceSlug, templateId);
    const [rows, people] = await Promise.all([
      db
        .select({
          id: auditEvents.id,
          at: auditEvents.at,
          actorId: auditEvents.actorId,
          action: auditEvents.action,
          details: auditEvents.details,
          versionNumber: versions.number,
          versionRound: versions.round,
          versionState: versions.state,
        })
        .from(auditEvents)
        .leftJoin(versions, eq(versions.id, auditEvents.versionId))
        .where(eq(auditEvents.templateId, template.id))
        // Same-moment rows (a submit and the change request it answers) read newest-written first.
        .orderBy(desc(auditEvents.at), desc(sql`${auditEvents}.rowid`))
        .limit(ACTIVITY_LIMIT),
      getPeople(),
    ]);

    return rows.map((r) => {
      const actor = r.actorId ? personOf(people, r.actorId) : null;
      const version =
        r.versionNumber !== null &&
        r.versionRound !== null &&
        r.versionState !== null
          ? {
              number: r.versionNumber,
              round: r.versionRound,
              state: r.versionState,
            }
          : null;
      return {
        id: r.id,
        at: iso(r.at),
        actor,
        action: r.action,
        versionLabel: eventVersionLabel(r.action, version),
        summary: describeActivity(
          { action: r.action, details: r.details ?? {}, version },
          actor,
        ),
      };
    });
  },
);
