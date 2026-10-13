import "server-only";
import type { AccessService } from "../access";
import type { DemoService } from "../demo";
import type { DraftService } from "../drafts";

import { notMoved, notMovedArea } from "../not-moved";
import type { ImplementationOptions } from "../options";
import type { PlatformService } from "../platform";
import type { RenderService } from "../render";
import type { Services } from "../types";
import type { UsageService } from "../usage";
import { now } from "@/server/clock";
import { localActivity } from "./activity";
import type { LocalDeps } from "./command";
import { localIdentity } from "./identity";
import { localNotifications } from "./notifications";
import { localReview } from "./review";
import { localReviewReads } from "./review-reads";
import { localThreads } from "./threads";
import { localVersions } from "./versions";
import { localWorkspace } from "./workspace";

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
    review: { ...localReview(deps), ...localReviewReads(deps) },
    versions: localVersions(deps),
    templates: {
      create: notMoved("templates.create"),
      createPermission: notMoved("templates.createPermission"),
      createImported: notMoved("templates.createImported"),
      startDraft: notMoved("templates.startDraft"),
      library: notMoved("templates.library"),
      palette: notMoved("templates.palette"),
      integration: notMoved("templates.integration"),
      copilotPrompt: notMoved("templates.copilotPrompt"),
      importOriginal: notMoved("templates.importOriginal"),
      importOriginalView: notMoved("templates.importOriginalView"),
      ...localWorkspace(deps),
    },
    drafts: notMovedArea<DraftService>("drafts"),
    comments: {
      add: notMoved("comments.add"),
      reply: notMoved("comments.reply"),
      resolve: notMoved("comments.resolve"),
      reopen: notMoved("comments.reopen"),
      ...localThreads(),
    },
    access: notMovedArea<AccessService>("access"),
    platform: notMovedArea<PlatformService>("platform"),
    notifications: localNotifications(deps),
    audit: {
      page: notMoved("audit.page"),
      exportRows: notMoved("audit.exportRows"),
      ...localActivity(deps),
    },
    usage: notMovedArea<UsageService>("usage"),
    render: notMovedArea<RenderService>("render"),
    demo: notMovedArea<DemoService>("demo"),
  };
}
