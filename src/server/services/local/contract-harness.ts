import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach } from "vitest";
import type { Db } from "@/server/db/client";
import { auditEvents, renderLog } from "@/server/db/schema/ucomp";
import { newId } from "@/server/ids";
import { listNotices } from "@/server/services/local/consumer-api";
import { runSunsetSweep } from "@/server/sunset-sweep";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { UsageHarness } from "../contract/harness";
import type { TestHooks } from "../options";
import { findRound } from "./find-round";
import { localServices } from "./index";

// The local implementation as the contract suite runs it (src/server/services/README.md, "The contract
// suite"). Test support, not a test file: the real seed on a database of its own for every test
// (`seededDatabasePerTest`, decision 0048). The test file mocks `@/server/db/client` with `tempDatabase()`;
// one local harness per file (a second would close the first's mocked client).

/**
 * Call it inside the `describe` that runs the cases, so its hooks belong to that block. It also records renders
 * (`UsageHarness`): the Usage cases need the render log at exact instants.
 */
export function localContractHarness(opts: { base: Date }): UsageHarness {
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
    renders: {
      async record(renders) {
        // One insert per render, in the order given: the rows' write order is the log's `seq` stand-in.
        for (const r of renders) {
          const version = await findRound(db!, r.templateId, r.versionNumber);
          if (!version)
            throw new Error(`No v${r.versionNumber} of ${r.templateId}.`);
          const outcome = r.outcome ?? "ok";
          await db!.insert(renderLog).values({
            id: newId("rl"),
            at: new Date(r.at),
            templateId: r.templateId,
            versionId: version.id,
            versionNumber: r.versionNumber,
            consumerId: r.consumerId,
            channel: r.channel,
            platform: r.platform ?? null,
            isPreview: r.isPreview ?? false,
            correlationId: "req_contract",
            outcome,
            errorCode:
              outcome === "error" ? (r.errorCode ?? "invalid_values") : null,
            durationMs: 1,
          });
        }
      },
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
    },
  };
}
