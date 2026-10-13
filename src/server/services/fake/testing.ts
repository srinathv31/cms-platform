import { beforeAll, beforeEach } from "vitest";
import { REQUEST_REFUSALS, refuse, type Refused } from "@/domain/refusals";
import type { RequestContext } from "@/server/context/request";
import { signInRequired } from "@/server/context/sign-in";
import type { Services } from "../types";
import { fakeServices } from "./index";
import { viewerOf } from "./rows";
import {
  cloneState,
  seededState,
  type FakeState,
  type SeededState,
} from "./state";

// Test support for the BFF's commands: its server actions (and the routes that write), run against the fake
// instead of a database (decision 0068). Not a test file itself. A test file swaps two modules for this one,
// then asks for a fake per test:
//
//   vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
//   vi.mock("@/server/context/request", () => import("@/server/services/fake/testing"));
//   const backend = fakeBackendPerTest({ base: BASE });
//   …
//   backend.as("alex");               // who is asking, from here on
//   await setSunset({ … });           // the real action, on the real kit, against the fake
//
// A read model's tests don't need it: they hand facts straight to its pure shaping function (`versionsData`).
// The seed is built in memory once per file and copied for every test, so no test sees another's writes.
// The exports below stand in for `services()` and the request context's three readers.

interface Current {
  services: Services;
  state: FakeState;
  context: RequestContext | null;
  clock: Date;
}

let current: Current | undefined;

function backend(): Current {
  if (!current)
    throw new Error(
      "No fake backend: call fakeBackendPerTest() at the top of the test file.",
    );
  return current;
}

/** The fake, in place of `services()` (src/server/services/index.ts). */
export function services(): Services {
  return backend().services;
}

/** In place of the request context's reader: the context `as()` set, or null (signed out). */
export async function findRequestContext(): Promise<RequestContext | null> {
  return backend().context;
}

/** In place of `requireRequestContext()`: off to sign in when signed out, as a page goes. */
export async function requireRequestContext(): Promise<RequestContext> {
  return backend().context ?? signInRequired();
}

/** In place of `requestContextOrRefusal()`: `signed_out` when nobody is. */
export async function requestContextOrRefusal(): Promise<
  { ok: true; context: RequestContext } | Refused
> {
  const context = backend().context;
  return context ? { ok: true, context } : refuse(REQUEST_REFUSALS.signedOut);
}

/** One test's fake backend, and who is asking. */
export interface FakeBackend {
  /** The seed's template ids by key; filled before the first test runs. */
  readonly templates: Record<string, string>;
  /** Signs a seeded person in from here on. Returns the context. */
  as(userId: string): RequestContext;
  /** Nobody is signed in from here on. */
  signOut(): void;
  /** Sets the backend's clock (the seed's base until then). */
  setClock(at: Date): void;
}

/**
 * Gives every test its own fake backend over a copy of the seed built on `base`, with its clock at `base`, and
 * signs nobody in. Call it once, at the top level of a test file that mocks the two modules as above.
 */
export function fakeBackendPerTest(opts: { base: Date }): FakeBackend {
  let seeded: SeededState | undefined;
  const templates: Record<string, string> = {};

  beforeAll(() => {
    seeded = seededState(opts.base);
    Object.assign(templates, seeded.templates);
  });

  beforeEach(() => {
    const state = cloneState(seeded!.state);
    const fresh: Current = {
      state,
      context: null,
      clock: opts.base,
      services: fakeServices(state, { clock: async () => fresh.clock }),
    };
    current = fresh;
  });

  return {
    templates,
    as(userId) {
      const viewer = viewerOf(backend().state, userId);
      if (!viewer) throw new Error(`No seeded user ${userId}.`);
      const context: RequestContext = {
        viewer,
        correlationId: "req_test",
        credential: { kind: "in_process", userId },
      };
      backend().context = context;
      return context;
    },
    signOut() {
      backend().context = null;
    },
    setClock(at) {
      backend().clock = at;
    },
  };
}
