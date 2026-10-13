import "server-only";
import { notFound } from "next/navigation";
import { can } from "@/domain/permissions";
import type { Action, PermissionResource, Viewer } from "@/domain/types";

// The one answer a read model gives a viewer who may not read what it serves: Not found, the same as for
// something that doesn't exist, so a page never tells someone who can't see a team, a settings section or
// the audit log whether it is there (decision 0052). The domain's `can()` decides; this only turns its
// refusal into `notFound()` (the Not found page; the streamed response is a 200, so not an HTTP 404).

/** Goes on when `can(viewer, action, resource)` allows it; otherwise `notFound()`. */
export function requireCan(
  viewer: Viewer,
  action: Action,
  resource?: PermissionResource,
): void {
  if (!can(viewer, action, resource).ok) notFound();
}
