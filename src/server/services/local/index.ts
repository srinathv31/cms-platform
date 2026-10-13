import "server-only";

import type { ImplementationOptions } from "../options";
import type { Services } from "../types";
import { now } from "@/server/clock";
import { newTemplateId } from "@/server/ids";
import { localAccess } from "./access";
import { localActivity } from "./activity";
import type { LocalDeps } from "./command";
import { localAccessReads } from "./access-reads";
import { localAuditReads } from "./audit";
import { localComments } from "./comments";
import { localDemo } from "./demo";
import { localDrafts } from "./drafts";
import { localIdentity } from "./identity";
import { localIntegration } from "./integration";
import { localLibrary } from "./library";
import { localNotifications } from "./notifications";
import { localPlatform } from "./platform";
import { localPlatformReads } from "./platform-reads";
import { localRender } from "./render";
import { localReview } from "./review";
import { localReviewReads } from "./review-reads";
import { localTemplates } from "./templates";
import { localThreads } from "./threads";
import { localUsage } from "./usage";
import { localVersions } from "./versions";
import { localWorkspace } from "./workspace";

// The local implementation: the service interfaces on this app's own database (Drizzle over SQLite) and the
// TypeScript domain. It is what the Java API replaces. Each area lives in its own file here; an area whose
// code still sits in src/server/actions/ or src/server/queries/ answers `notMovedArea` until it moves.

/** What the local implementation is built with, beside the options every implementation takes. */
export interface LocalOptions extends ImplementationOptions {
  /** Where an import's files go; the configured uploads folder (`UPLOADS_DIR`) when absent. */
  uploadsRoot?: string;
}

export function localServices(options: LocalOptions = {}): Services {
  // The demo clock: the real time plus the clock offset Advance clock moves (src/server/clock.ts).
  const deps: LocalDeps = {
    clock: options.clock ?? now,
    ids: options.ids ?? { templateId: newTemplateId },
    hooks: options.hooks ?? {},
    uploadsRoot: options.uploadsRoot,
  };
  const identity = localIdentity();
  return {
    identity,
    review: { ...localReview(deps), ...localReviewReads(deps) },
    versions: localVersions(deps),
    templates: {
      ...localTemplates(deps),
      ...localWorkspace(deps),
      ...localLibrary(deps),
      ...localIntegration(deps),
    },
    drafts: localDrafts(deps),
    comments: { ...localComments(deps), ...localThreads() },
    access: { ...localAccess(deps), ...localAccessReads(deps) },
    platform: { ...localPlatform(deps), ...localPlatformReads(deps) },
    notifications: localNotifications(deps),
    audit: { ...localAuditReads(deps), ...localActivity(deps) },
    usage: localUsage(deps),
    render: localRender(deps),
    demo: localDemo(deps, identity),
  };
}
