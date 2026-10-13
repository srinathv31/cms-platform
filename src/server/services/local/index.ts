import "server-only";
import type { AccessService } from "../access";
import type { AuditService } from "../audit";
import type { CommentService } from "../comments";
import type { DemoService } from "../demo";
import type { DraftService } from "../drafts";

import { notMovedArea } from "../not-moved";
import type { ImplementationOptions } from "../options";
import type { PlatformService } from "../platform";
import type { RenderService } from "../render";
import type { TemplateService } from "../templates";
import type { Services } from "../types";
import type { UsageService } from "../usage";
import { now } from "@/server/clock";
import type { LocalDeps } from "./command";
import { localIdentity } from "./identity";
import { localNotifications } from "./notifications";
import { localReview } from "./review";
import { localVersions } from "./versions";

// The local implementation: the service interfaces on this app's own database (Drizzle over SQLite) and the
// TypeScript domain. It is what the Java API replaces. Each area lives in its own file here; an area whose
// code still sits in src/server/actions/ or src/server/queries/ answers `notMovedArea` until it moves.

export function localServices(options: ImplementationOptions = {}): Services {
  // The demo clock: the real time plus the clock offset Advance clock moves (src/server/clock.ts).
  const deps: LocalDeps = {
    clock: options.clock ?? now,
    hooks: options.hooks ?? {},
  };
  return {
    identity: localIdentity(),
    review: localReview(deps),
    versions: localVersions(deps),
    templates: notMovedArea<TemplateService>("templates"),
    drafts: notMovedArea<DraftService>("drafts"),
    comments: notMovedArea<CommentService>("comments"),
    access: notMovedArea<AccessService>("access"),
    platform: notMovedArea<PlatformService>("platform"),
    notifications: localNotifications(deps),
    audit: notMovedArea<AuditService>("audit"),
    usage: notMovedArea<UsageService>("usage"),
    render: notMovedArea<RenderService>("render"),
    demo: notMovedArea<DemoService>("demo"),
  };
}
