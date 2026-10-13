import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach } from "vitest";
import type { Db } from "@/server/db/client";
import { auditEvents, notifications } from "@/server/db/schema/ucomp";
import { listNotices } from "@/server/queries/consumer-api";
import { runSunsetSweep } from "@/server/sunset-sweep";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { ContractHarness } from "../contract/harness";
import type { TestHooks } from "../options";
import { localServices } from "./index";

// The local implementation as the contract suite runs it (src/server/services/README.md, "The contract
// suite"). Test support, not a test file: the real seed on a database of its own for every test
// (`seededDatabasePerTest`, decision 0048). The test file mocks `@/server/db/client` with `tempDatabase()`;
// one local harness per file (a second would close the first's mocked client).

/** Call it inside the `describe` that runs the cases, so its hooks belong to that block. */
export function localContractHarness(opts: { base: Date }): ContractHarness {
  const templates = seededDatabasePerTest({ base: opts.base });
  let db: Db | undefined;
  let clock = opts.base;
  let hooks: TestHooks = {};
  beforeAll(async () => {
    ({ db } = await import("@/server/db/client"));
  });
  beforeEach(() => {
    clock = opts.base;
    hooks = {};
  });
  const services = localServices({
    clock: async () => clock,
    // Read when a command reaches its compare-and-set, so a case can set them at any point.
    hooks: {
      beforeCompareAndSet: (target) => hooks.beforeCompareAndSet?.(target),
    },
  });

  return {
    name: "local",
    templates,
    services: () => services,
    setClock(at) {
      clock = at;
    },
    async as(userId) {
      return {
        viewer: await loadPersona(db!, userId),
        correlationId: "req_contract",
        credential: { kind: "in_process", userId },
      };
    },
    hooks(next) {
      hooks = next;
    },
    async runScheduledJobs(at) {
      // The sunset sweep; the access sweep joins when the fake has its twin (plan P2).
      await runSunsetSweep(at);
    },
    async consumerNotices(consumerId, templateId) {
      const page = await listNotices(consumerId, {
        templateId,
        limit: 100_000,
      });
      return page.notices;
    },
    probe: {
      async auditEvents({ versionId }) {
        const rows = await db!
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.versionId, versionId))
          .orderBy(sql`rowid`);
        return rows.map((e) => ({
          action: e.action,
          at: e.at.toISOString(),
          actorId: e.actorId,
          teamId: e.teamId,
          templateId: e.templateId,
          versionId: e.versionId,
          details: e.details,
        }));
      },
      async notifications({ userId }) {
        const rows = await db!
          .select({ userId: notifications.userId, kind: notifications.kind })
          .from(notifications)
          .where(eq(notifications.userId, userId))
          .orderBy(asc(sql`rowid`));
        return rows;
      },
    },
  };
}
