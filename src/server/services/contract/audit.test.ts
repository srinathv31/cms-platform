import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NO_AUDIT_SEARCH } from "@/domain/audit";
import type { Db } from "@/server/db/client";
import { versions } from "@/server/db/schema/ucomp";
import { localContractHarness } from "../local/contract-harness";
import { auditContract } from "./audit";

// The audit contract (./audit.ts) against the local implementation, on a seeded database per test. The fake
// doesn't implement these reads (decision 0072: a read in the fake only where a case must observe a command),
// so there is no fake run.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-contract-audit-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");

describe("local", () => {
  const h = localContractHarness({ base: BASE });
  auditContract(h, BASE);

  // Local only: it renames a version straight in the database, which no service command does yet.
  describe("a renamed template", () => {
    let db: Db;
    beforeAll(async () => {
      ({ db } = await import("@/server/db/client"));
    });

    it("names each event's template as its version had it; the Template menu lists it by the name it has now", async () => {
      const [v2] = await db
        .select()
        .from(versions)
        .where(
          and(
            eq(versions.name, "Balance Transfer Intro — Terms"),
            eq(versions.number, 2),
          ),
        );
      await db
        .update(versions)
        .set({ name: "Balance Transfer Intro — Card Terms" })
        .where(
          and(eq(versions.templateId, v2!.templateId), eq(versions.number, 2)),
        );

      const taylor = await h.as("taylor");
      const result = await h.services().audit.page(taylor, {
        teamId: null,
        search: { ...NO_AUDIT_SEARCH, templateIds: [v2!.templateId] },
      });
      if (!result.ok) throw new Error(result.code);
      const named = (number: number | null, action?: string) =>
        new Set(
          result.events
            .filter(
              (e) =>
                (e.version?.number ?? null) === number &&
                (!action || e.action === action),
            )
            .map((e) => e.templateName),
        );
      expect(named(1)).toEqual(new Set(["Balance Transfer Intro — Terms"]));
      expect(named(2)).toEqual(
        new Set(["Balance Transfer Intro — Card Terms"]),
      );
      expect(named(null, "template.created")).toEqual(
        new Set(["Balance Transfer Intro — Card Terms"]),
      );
      expect(
        result.options.templates.find((t) => t.id === v2!.templateId)?.name,
      ).toBe("Balance Transfer Intro — Card Terms");
      expect(new Set(result.events.map((e) => e.templateCurrentName))).toEqual(
        new Set(["Balance Transfer Intro — Card Terms"]),
      );

      // The export keeps each event's own name too.
      const exported = await h.services().audit.exportRows(taylor, {
        teamId: null,
        search: { ...NO_AUDIT_SEARCH, templateIds: [v2!.templateId] },
      });
      if (!exported.ok) throw new Error(exported.code);
      expect(
        new Set(
          exported.events
            .filter((e) => e.version?.number === 1)
            .map((e) => e.templateName),
        ),
      ).toEqual(new Set(["Balance Transfer Intro — Terms"]));
    });
  });
});
