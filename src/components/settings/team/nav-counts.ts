import "server-only";
import {
  getAccessRequestsSection,
  getInactivitySection,
  getRecertificationSection,
} from "@/server/queries/access";

/**
 * The muted trails on the Team nav items that need action: requests waiting, members flagged, and
 * the open review's progress ("4/6"). A section with nothing to do has no trail. Cached queries, so
 * the section body shares them. Call only for a viewer who manages the team.
 */
export async function getTeamNavTrails(teamSlug: string): Promise<Record<string, string>> {
  const [requests, recert, inactivity] = await Promise.all([
    getAccessRequestsSection(teamSlug),
    getRecertificationSection(teamSlug),
    getInactivitySection(teamSlug),
  ]);
  const trails: Record<string, string> = {};
  if (requests.pending.length > 0) trails["access-requests"] = String(requests.pending.length);
  const review = recert.current;
  if (review && review.phase === "open" && review.progress.pending > 0) {
    trails.recertification = `${review.progress.decided}/${review.progress.total}`;
  }
  if (inactivity.flagged.length > 0) trails.inactivity = String(inactivity.flagged.length);
  return trails;
}
