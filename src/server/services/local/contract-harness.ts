import { asc, eq, sql } from "drizzle-orm";
import { beforeAll } from "vitest";
import type { Db } from "@/server/db/client";
import {
  auditEvents,
  consumerNotices,
  notifications,
} from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { ContractHarness } from "../contract/harness";
import { localServices } from "./index";

// The local implementation as the contract suite runs it (src/server/services/README.md, "The contract
// suite"). Test support, not a test file: the real seed on a database of its own for every test
// (`seededDatabasePerTest`, decision 0048). The test file mocks `@/server/db/client` with `tempDatabase()`.

/** Call it inside the `describe` that runs the cases, so its hooks belong to that block. */
export function localContractHarness(opts: { base: Date }): ContractHarness {
  const templates = seededDatabasePerTest({ base: opts.base });
  let db: Db | undefined;
  beforeAll(async () => {
    ({ db } = await import("@/server/db/client"));
  });
  const services = localServices();
  const iso = (date: Date) => date.toISOString();

  return {
    name: "local",
    templates,
    services: () => services,
    async as(userId, at) {
      return {
        viewer: await loadPersona(db!, userId),
        now: at,
        correlationId: "req_contract",
        credential: { kind: "in_process" },
      };
    },
    probe: {
      async auditEvents({ versionId }) {
        const rows = await db!
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.versionId, versionId))
          .orderBy(asc(auditEvents.at), sql`rowid`);
        return rows.map((e) => ({
          action: e.action,
          at: iso(e.at),
          actorId: e.actorId,
          teamId: e.teamId,
          templateId: e.templateId,
          versionId: e.versionId,
          details: e.details,
        }));
      },
      async consumerNotices({ templateId }) {
        const rows = await db!
          .select()
          .from(consumerNotices)
          .where(eq(consumerNotices.templateId, templateId))
          .orderBy(asc(consumerNotices.seq));
        return rows.map((n) => ({
          seq: n.seq,
          consumerId: n.consumerId,
          templateId: n.templateId,
          versionId: n.versionId,
          kind: n.kind,
          payload: n.payload,
          createdAt: iso(n.createdAt),
        }));
      },
      async notifications({ userId }) {
        const rows = await db!
          .select()
          .from(notifications)
          .where(eq(notifications.userId, userId))
          .orderBy(asc(notifications.createdAt), sql`rowid`);
        return rows.map((n) => ({
          userId: n.userId,
          kind: n.kind,
          title: n.title,
          href: n.href,
          createdAt: iso(n.createdAt),
        }));
      },
    },
  };
}
