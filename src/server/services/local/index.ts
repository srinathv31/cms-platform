import "server-only";

import { notMoved, notMovedArea } from "../not-moved";
import type { ImplementationOptions } from "../options";
import type { Services } from "../types";
import type { UsageService } from "../usage";
import { now } from "@/server/clock";
import { newTemplateId } from "@/server/ids";
import { localAccess } from "./access";
import { localActivity } from "./activity";
import type { LocalDeps } from "./command";
import { localComments } from "./comments";
import { localDemo } from "./demo";
import { localDrafts } from "./drafts";
import { localIdentity } from "./identity";
import { localNotifications } from "./notifications";
import { localPlatform } from "./platform";
import { localRender } from "./render";
import { localReview } from "./review";
import { localReviewReads } from "./review-reads";
import { localTemplates } from "./templates";
import { localThreads } from "./threads";
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
    templates: { ...localTemplates(deps), ...localWorkspace(deps) },
    drafts: localDrafts(deps),
    comments: { ...localComments(deps), ...localThreads() },
    access: localAccess(deps),
    platform: localPlatform(deps),
    notifications: localNotifications(deps),
    audit: {
      page: notMoved("audit.page"),
      exportRows: notMoved("audit.exportRows"),
      ...localActivity(deps),
    },
    usage: notMovedArea<UsageService>("usage"),
    render: localRender(deps),
    demo: localDemo(deps, identity),
  };
}
