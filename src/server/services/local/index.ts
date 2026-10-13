import "server-only";
import type { AccessService } from "../access";
import type { AuditService } from "../audit";
import type { ClockService } from "../clock";
import type { CommentService } from "../comments";
import type { DemoService } from "../demo";
import type { DraftService } from "../drafts";
import type { IdentityService } from "../identity";
import { notMovedArea } from "../not-moved";
import type { NotificationService } from "../notifications";
import type { PlatformService } from "../platform";
import type { RenderService } from "../render";
import type { TemplateService } from "../templates";
import type { Services } from "../types";
import type { UsageService } from "../usage";
import { localReview } from "./review";
import { localVersions } from "./versions";

// The local implementation: the service interfaces on this app's own database (Drizzle over SQLite) and the
// TypeScript domain. It is what the Java API replaces. Each area lives in its own file here; an area whose
// code still sits in src/server/actions/ or src/server/queries/ answers `notMovedArea` until it moves.

export function localServices(): Services {
  return {
    identity: notMovedArea<IdentityService>("identity"),
    clock: notMovedArea<ClockService>("clock"),
    review: localReview,
    versions: localVersions,
    templates: notMovedArea<TemplateService>("templates"),
    drafts: notMovedArea<DraftService>("drafts"),
    comments: notMovedArea<CommentService>("comments"),
    access: notMovedArea<AccessService>("access"),
    platform: notMovedArea<PlatformService>("platform"),
    notifications: notMovedArea<NotificationService>("notifications"),
    audit: notMovedArea<AuditService>("audit"),
    usage: notMovedArea<UsageService>("usage"),
    render: notMovedArea<RenderService>("render"),
    demo: notMovedArea<DemoService>("demo"),
  };
}
