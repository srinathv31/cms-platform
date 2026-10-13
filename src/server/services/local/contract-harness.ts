import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach } from "vitest";
import type { Db } from "@/server/db/client";
import {
  auditEvents,
  commentThreads,
  comments,
  templates as templatesTable,
  versions,
} from "@/server/db/schema/ucomp";
import { newTemplateId } from "@/server/ids";
import { listNotices } from "@/server/queries/consumer-api";
import { runSunsetSweep } from "@/server/sunset-sweep";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import { probeVersionRow, type ContractHarness } from "../contract/harness";
import type { IdSource, TestHooks } from "../options";
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
  let ids: IdSource | undefined;
  // An import's files go to a folder of this file's own, never the demo's.
  const uploadsRoot = mkdtempSync(
    path.join(tmpdir(), "ucomp-contract-uploads-"),
  );
  beforeAll(async () => {
    ({ db } = await import("@/server/db/client"));
  });
  afterAll(() => {
    rmSync(uploadsRoot, { recursive: true, force: true });
  });
  beforeEach(() => {
    clock = opts.base;
    hooks = {};
    ids = undefined;
  });
  const services = localServices({
    uploadsRoot,
    clock: async () => clock,
    // Read when a template is made, so a case can set it at any point.
    ids: { templateId: () => (ids ? ids.templateId() : newTemplateId()) },
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
    ids(next) {
      ids = next;
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
      async template({ templateId }) {
        const row = await db!.query.templates.findFirst({
          where: eq(templatesTable.id, templateId),
        });
        if (!row) return null;
        const events = await db!
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.templateId, templateId))
          .orderBy(sql`rowid`);
        return {
          teamId: row.teamId,
          contentTypeId: row.contentTypeId,
          starterKey: row.starterKey,
          createdBy: row.createdBy,
          createdAt: row.createdAt.toISOString(),
          versions: (
            await db!
              .select()
              .from(versions)
              .where(eq(versions.templateId, templateId))
              .orderBy(sql`rowid`)
          ).map(probeVersionRow),
          audit: events.map((e) => ({
            action: e.action,
            at: e.at.toISOString(),
            actorId: e.actorId,
            teamId: e.teamId,
            templateId: e.templateId,
            versionId: e.versionId,
            details: e.details,
          })),
        };
      },
      async templateIds() {
        return (
          await db!.select({ id: templatesTable.id }).from(templatesTable)
        ).map((t) => t.id);
      },
      async threads({ templateId }) {
        const rows = await db!
          .select()
          .from(commentThreads)
          .where(eq(commentThreads.templateId, templateId))
          .orderBy(sql`rowid`);
        return Promise.all(
          rows.map(async (t) => ({
            id: t.id,
            originVersionId: t.originVersionId,
            blockId: t.blockId,
            quote: t.quote,
            status: t.status,
            resolvedBy: t.resolvedBy,
            resolvedAt: t.resolvedAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
            comments: (
              await db!
                .select()
                .from(comments)
                .where(eq(comments.threadId, t.id))
                .orderBy(sql`rowid`)
            ).map((c) => ({
              authorId: c.authorId,
              body: c.body,
              kind: c.kind,
              at: c.createdAt.toISOString(),
            })),
          })),
        );
      },
    },
  };
}
