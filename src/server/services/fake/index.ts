import { notMoved, notMovedArea } from "../not-moved";
import type {
  Clock,
  IdSource,
  ImplementationOptions,
  TestHooks,
} from "../options";
import type { RenderService } from "../render";
import type { Services } from "../types";
import type { UsageService } from "../usage";
import { newTemplateId } from "@/server/ids";
import { fakeAccess } from "./access";
import { fakeActivity } from "./activity";
import { fakeComments } from "./comments";
import { fakeDemo } from "./demo";
import { fakeDrafts } from "./drafts";
import { fakeIdentity } from "./identity";
import { fakeNotifications } from "./notifications";
import { fakePlatform } from "./platform";
import { fakeReview } from "./review";
import type { FakeState } from "./state";
import { FakeStore } from "./store";
import { fakeTemplates } from "./templates";
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
  ids: IdSource;
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
    ids: options.ids ?? { templateId: newTemplateId },
    hooks: options.hooks ?? {},
  };
  const identity = fakeIdentity(state);
  return {
    identity,
    review: fakeReview(deps),
    versions: fakeVersions(deps),
    templates: fakeTemplates(deps),
    drafts: fakeDrafts(deps),
    comments: { ...fakeComments(deps), ...fakeThreads(deps) },
    access: fakeAccess(deps),
    platform: fakePlatform(deps),
    notifications: fakeNotifications(deps),
    audit: {
      page: notMoved("audit.page"),
      exportRows: notMoved("audit.exportRows"),
      ...fakeActivity(deps),
    },
    usage: notMovedArea<UsageService>("usage"),
    // The preview is a read no contract case observes a command through, so the fake doesn't render: the preview
    // route's tests hand it facts (decision 0072's slim fake).
    render: {
      preview: async () => {
        throw new Error(
          "The fake doesn't render: test the preview on facts (src/server/services/README.md, The fake).",
        );
      },
    } satisfies RenderService,
    demo: fakeDemo(deps, identity),
  };
}
