import { getReviewBadgeCount } from "@/server/queries/review";
import { getShell } from "@/server/queries/spaces";
import { SidebarBody } from "./sidebar-body";
import { TeamSwitcher } from "./team-switcher";

// Persona-dependent parts of the sidebar. Rendered inside <Stream> boundaries by the frame.

export async function TeamSwitcherHole() {
  const { spaces } = await getShell();
  return <TeamSwitcher spaces={spaces} />;
}

export async function SidebarBodyHole() {
  const { spaces } = await getShell();
  // The Review badge counts what waits on this viewer, space by space (so a team switch never refetches).
  // Nothing awaits it here: the nav paints at once and the badge streams in after it, into a slot that
  // is already there (the row's right edge), so nothing moves. A failed count just leaves the badge out.
  const reviewCounts = Promise.all(
    spaces.map(async (space): Promise<[string, number]> => [
      space.slug,
      await getReviewBadgeCount(space.slug).catch(() => 0),
    ]),
  ).then((entries) => Object.fromEntries(entries) as Record<string, number>);
  return <SidebarBody spaces={spaces} reviewCounts={reviewCounts} />;
}
