import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/client";
import { memberships, recertifications } from "@/server/db/schema/ucomp";
import {
  loadPersona,
  seededDatabasePerTest,
} from "@/server/testing/review-fixtures";
import type { RequestContext } from "../types";
import { localServices } from "./index";

// The access commands' lazy trigger, which only the local implementation has (the Java API runs its scheduled jobs
// on a schedule, and the contract suite runs them through `runScheduledJobs`): once its permission check has passed,
// an access command runs the scheduled jobs at its own instant, each in its own transaction, before it reads its
// facts, so a deadline the clock already crossed takes effect first and a refusal doesn't roll it back. Seed facts
// it relies on: Coral Offers' review is due 30 days after the seed, nobody decided; Alex is its Team Admin.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-local-access-");
});

const BASE = new Date("2026-10-04T12:00:00.000Z");
const DAY = 86_400_000;

let db: Db;
let clock = BASE;
const services = localServices({ clock: async () => clock });

seededDatabasePerTest({ base: BASE });

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

async function as(userId: string): Promise<RequestContext> {
  return {
    viewer: await loadPersona(db, userId),
    correlationId: "req_test",
    credential: { kind: "in_process", userId },
  };
}

const coral = (userId: string) =>
  db.query.memberships.findFirst({
    where: and(
      eq(memberships.teamId, "t_coral"),
      eq(memberships.userId, userId),
    ),
  });

describe("an access command, once the clock has passed a deadline", () => {
  it("applies the deadline first, dated when it fell due, and keeps it when the command is refused", async () => {
    const review = (await db.query.recertifications.findFirst({
      where: eq(recertifications.teamId, "t_coral"),
    }))!;
    clock = new Date(BASE.getTime() + 31 * DAY);
    // Every undecided member lapsed at the deadline, so nobody is left for a new review.
    expect(
      await services.access.startRecertification(await as("alex"), {
        teamId: "t_coral",
      }),
    ).toMatchObject({ ok: false, code: "nobody_to_recertify" });
    expect(
      (
        await db.query.recertifications.findFirst({
          where: eq(recertifications.id, review.id),
        })
      )?.completedAt,
    ).toEqual(review.dueAt);
    expect(await coral("sam")).toMatchObject({
      status: "lapsed",
      statusChangedAt: review.dueAt,
    });
    expect(await coral("alex")).toMatchObject({ status: "active" });
  });

  it("runs nothing before its permission check", async () => {
    clock = new Date(BASE.getTime() + 31 * DAY);
    expect(
      await services.access.startRecertification(await as("maya"), {
        teamId: "t_coral",
      }),
    ).toMatchObject({ ok: false, code: "generic" });
    expect(await coral("sam")).toMatchObject({ status: "active" });
  });
});
