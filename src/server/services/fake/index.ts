import type {
  Clock,
  IdSource,
  ImplementationOptions,
  TestHooks,
} from "../options";
import type { Services } from "../types";
import { newTemplateId } from "@/server/ids";
import { fakeAccess } from "./access";
import { fakeActivity } from "./activity";
import { fakeComments } from "./comments";
import { fakeDemo } from "./demo";
import { fakeDrafts } from "./drafts";
import { fakeIdentity } from "./identity";
import { fakeLibrary } from "./library";
import { notInFake } from "./not-in-fake";
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
// needs it to observe a command (the version history, the bell, a template's activity and threads, the Library
// and the palette). The other reads answer `notInFake`: the BFF's read models are tested on facts handed
// straight to their pure shaping functions, and the reads' contract cases run against the local implementation.
//
// Not for production: no persistence and no concurrency beyond JavaScript's own turn-taking.

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
    // The fake reads the Library and the palette (a case watches a command move a template there), not the SHARE
    // panel or the Copilot prompt, which no command changes.
    templates: { ...fakeTemplates(deps), ...fakeLibrary(deps) },
    drafts: fakeDrafts(deps),
    comments: { ...fakeComments(deps), ...fakeThreads(deps) },
    access: fakeAccess(deps),
    platform: fakePlatform(deps),
    notifications: fakeNotifications(deps),
    audit: {
      page: notInFake("audit.page"),
      exportRows: notInFake("audit.exportRows"),
      ...fakeActivity(deps),
    },
    usage: {
      dashboard: notInFake("usage.dashboard"),
      template: notInFake("usage.template"),
    },
    // The fake doesn't render: the preview route's tests hand it facts.
    render: { preview: notInFake("render.preview") },
    demo: fakeDemo(deps, identity),
  };
}
