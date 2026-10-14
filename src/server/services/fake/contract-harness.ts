import { beforeAll, beforeEach } from "vitest";
import { newTemplateId } from "@/server/ids";
import type { ContractHarness } from "../contract/harness";
import type { IdSource, TestHooks } from "../options";
import type { Services } from "../types";
import { fakeConsumerNotices } from "./consumer-api";
import { fakeServices } from "./index";
import { viewerOf } from "./identity";
import {
  cloneState,
  seededState,
  type FakeState,
  type SeededState,
} from "./state";
import { FakeStore } from "./store";
import { runFakeScheduledJobs } from "./sweeps";

// The fake as the contract suite runs it (src/server/services/README.md, "The contract suite"). Test support,
// not a test file: a fresh copy of the seed for every test, built in memory once per file, with a clock the case
// sets and hooks it can reach into commands with.

/** Call it inside the `describe` that runs the cases, so its hooks belong to that block. */
export function fakeContractHarness(opts: { base: Date }): ContractHarness {
  let seeded: SeededState | undefined;
  let state: FakeState | undefined;
  let services: Services | undefined;
  let clock = opts.base;
  let hooks: TestHooks = {};
  let ids: IdSource | undefined;
  const templates: Record<string, string> = {};

  beforeAll(() => {
    seeded = seededState(opts.base);
    Object.assign(templates, seeded.templates);
  });
  beforeEach(() => {
    state = cloneState(seeded!.state);
    clock = opts.base;
    hooks = {};
    ids = undefined;
    services = fakeServices(state, {
      clock: async () => clock,
      // Read when a template is made, so a case can set it after building the services.
      ids: { templateId: () => (ids ? ids.templateId() : newTemplateId()) },
      // Read when a command reaches its compare-and-set, so a case can set them after building the services.
      hooks: {
        beforeCompareAndSet: (target) => hooks.beforeCompareAndSet?.(target),
      },
    });
  });

  return {
    name: "fake",
    templates,
    services: () => services!,
    setClock(at) {
      clock = at;
    },
    async as(userId) {
      const viewer = viewerOf(state!, userId);
      if (!viewer) throw new Error(`No seeded user ${userId}.`);
      return {
        viewer,
        correlationId: "req_contract",
        credential: { kind: "in_process", userId },
      };
    },
    hooks(next) {
      hooks = next;
    },
    ids(next) {
      ids = next;
    },
    async runScheduledJobs(at) {
      runFakeScheduledJobs(new FakeStore(state!), at);
    },
    async consumerNotices(consumerId, templateId) {
      return fakeConsumerNotices(state!, consumerId, templateId);
    },
  };
}
