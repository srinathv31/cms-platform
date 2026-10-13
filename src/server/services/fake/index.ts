import type { AccessService } from "../access";
import type { DemoService } from "../demo";
import type { DraftService } from "../drafts";

import { notMoved, notMovedArea } from "../not-moved";
import type { Clock, ImplementationOptions, TestHooks } from "../options";
import type { PlatformService } from "../platform";
import type { RenderService } from "../render";
import type { TemplateService } from "../templates";
import type { Services } from "../types";
import type { UsageService } from "../usage";
import { fakeActivity } from "./activity";
import { fakeIdentity } from "./identity";
import { fakeNotifications } from "./notifications";
import { fakeReview } from "./review";
import type { FakeState } from "./state";
import { FakeStore } from "./store";
import { fakeThreads } from "./threads";
import { fakeVersions } from "./versions";

// The in-memory fake of the service interfaces (decision 0068): the real domain rules over arrays instead of a
// database, so the BFF's tests run without one and still meet a backend that behaves. It stays honest because
// the contract suite (../contract) runs the same cases against it and against the local implementation; a
// behaviour one has and the other lacks fails there.
//
// It is kept slim (decision 0072): every command is implemented in full, and a read only where a contract case
// needs it to observe a command. The BFF's read models are tested on facts handed straight to their pure
// shaping functions, not through the fake.
//
// Not for production: no persistence, no concurrency beyond JavaScript's own turn-taking, and only the areas
// that have moved behind the seam (the others answer `notMovedArea`, as in the local implementation).

/** What every fake area is built with. */
export interface FakeDeps {
  store: FakeStore;
  clock: Clock;
  hooks: TestHooks;
}

/** The fake, over `state` (which it changes in place). Its clock is the real time unless the test sets one. */
export function fakeServices(
  state: FakeState,
  options: ImplementationOptions = {},
): Services {
  const deps: FakeDeps = {
    store: new FakeStore(state),
    clock: options.clock ?? (async () => new Date()),
    hooks: options.hooks ?? {},
  };
  return {
    identity: fakeIdentity(state),
    review: fakeReview(deps),
    versions: fakeVersions(deps),
    templates: notMovedArea<TemplateService>("templates"),
    drafts: notMovedArea<DraftService>("drafts"),
    comments: {
      add: notMoved("comments.add"),
      reply: notMoved("comments.reply"),
      resolve: notMoved("comments.resolve"),
      reopen: notMoved("comments.reopen"),
      ...fakeThreads(deps),
    },
    access: notMovedArea<AccessService>("access"),
    platform: notMovedArea<PlatformService>("platform"),
    notifications: fakeNotifications(deps),
    audit: {
      page: notMoved("audit.page"),
      exportRows: notMoved("audit.exportRows"),
      ...fakeActivity(deps),
    },
    usage: notMovedArea<UsageService>("usage"),
    render: notMovedArea<RenderService>("render"),
    demo: notMovedArea<DemoService>("demo"),
  };
}
