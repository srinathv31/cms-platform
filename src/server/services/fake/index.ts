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
import { fakeReview } from "./review";
import { FakeStore } from "./store";
import type { FakeState } from "./state";
import { fakeVersions } from "./versions";

// The in-memory fake of the service interfaces (decision 0068): the real domain rules over arrays instead
// of a database, so the BFF's tests (actions, routes, read models) run without one and still meet a backend
// that behaves. It stays honest because the contract suite (../contract) runs the same cases against it and
// against the local implementation; a behaviour one has and the other lacks fails there.
//
// Not for production: no persistence, no concurrency beyond JavaScript's own turn-taking, and only the areas
// that have moved behind the seam (the others answer `notMovedArea`, as in the local implementation).

/** The fake, over `state` (which it changes in place). */
export function fakeServices(state: FakeState): Services {
  const store = new FakeStore(state);
  return {
    identity: notMovedArea<IdentityService>("identity"),
    clock: notMovedArea<ClockService>("clock"),
    review: fakeReview(store),
    versions: fakeVersions(store),
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
