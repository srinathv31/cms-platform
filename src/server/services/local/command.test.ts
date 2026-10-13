import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { COMMENT_REFUSALS, canComment } from "@/domain/comments";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import type { Viewer } from "@/domain/types";
import type { Db } from "@/server/db/client";
import { settings } from "@/server/db/schema/ucomp";
import { freshDatabasePerTest } from "@/server/testing/review-fixtures";
import type { RequestContext } from "../types";
import {
  check,
  permit,
  refuse,
  runCommand,
  type CommandSteps,
} from "./command";

// The local implementation's command kit (`runCommand`): authorize, then the backend's clock once, then one
// transaction; a refusal anywhere rolls back and becomes the answer. Against a temporary migrated database: the
// writes go to `settings`, a plain key-value table, so a rolled-back write is easy to see.

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-command-kit-");
});

const NOW = new Date("2026-10-09T12:00:00.000Z");

const admin: Viewer = {
  userId: "riley",
  name: "Riley Chen",
  initials: "RC",
  title: "Platform Admin",
  platformRole: "platform_admin",
  memberships: [],
};
const author: Viewer = {
  userId: "maya",
  name: "Maya Patel",
  initials: "MP",
  title: "Author",
  platformRole: null,
  memberships: [
    {
      teamId: "t_coral",
      teamSlug: "coral-offers",
      teamName: "Coral Offers",
      roles: ["author"],
      status: "active",
    },
  ],
};
const contextOf = (viewer: Viewer): RequestContext => ({
  viewer,
  correlationId: "req_test",
  credential: { kind: "in_process", userId: viewer.userId },
});

let db: Db;

freshDatabasePerTest();

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

interface Input {
  key: string;
  value: string;
}

const stored = async (key: string) =>
  (await db.select().from(settings).where(eq(settings.key, key)))[0]?.value;

/** A command that writes the input to `settings`, as Platform Admin, with the steps given swapped in. */
function write(
  input: Input,
  over: Partial<CommandSteps<Input, void, { key: string }>> = {},
  viewer: Viewer = admin,
) {
  const clock = vi.fn(async () => NOW);
  const answer = runCommand<Input, void, { key: string }>(
    { clock, hooks: {}, ids: { templateId: () => "UC-UNUSED" } },
    contextOf(viewer),
    input,
    {
      authorize: ({ ctx }) =>
        check(ctx.viewer, "platform.manage", { teamId: null }),
      transaction: async (tx, { input }) => {
        await tx
          .insert(settings)
          .values({ key: input.key, value: input.value });
        return { ok: true, key: input.key };
      },
      ...over,
    },
  );
  return { answer, clock };
}

describe("runCommand", () => {
  it("runs authorize, then reads the clock once, then the transaction, dated by that clock", async () => {
    const order: string[] = [];
    const { answer, clock } = write(
      { key: "kit_ok", value: "written" },
      {
        authorize: ({ ctx, input }) => {
          order.push(`authorize ${ctx.viewer.userId} ${input.key}`);
          check(ctx.viewer, "platform.manage", { teamId: null });
        },
        transaction: async (tx, { input, now }) => {
          order.push(`transaction at ${now.toISOString()}`);
          await tx
            .insert(settings)
            .values({ key: input.key, value: input.value });
          return { ok: true, key: input.key };
        },
      },
    );
    expect(await answer).toEqual({ ok: true, key: "kit_ok" });
    expect(order).toEqual([
      "authorize riley kit_ok",
      `transaction at ${NOW.toISOString()}`,
    ]);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(await stored("kit_ok")).toBe("written");
  });

  it("returns a permission refusal from `check` before the clock is read, and writes nothing", async () => {
    const { answer, clock } = write(
      { key: "kit_forbidden", value: "x" },
      {},
      author,
    );
    expect(await answer).toEqual({ ok: false, ...REASONS.generic });
    expect(await stored("kit_forbidden")).toBeUndefined();
    expect(clock).not.toHaveBeenCalled();
  });

  it("returns a domain rule's refusal through `permit`", async () => {
    const active = { state: "active" as const, stageApproverIds: [] };
    const { answer } = write(
      { key: "kit_permit", value: "x" },
      {
        authorize: ({ ctx }) =>
          permit(
            canComment(ctx.viewer, { teamId: "t_coral", version: active }),
          ),
      },
      author,
    );
    expect(await answer).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
    expect(await stored("kit_permit")).toBeUndefined();
  });

  it("returns a refusal raised inside the transaction, rolled back, instead of throwing", async () => {
    const { answer } = write(
      { key: "kit_refused", value: "x" },
      {
        transaction: async (tx, { input }) => {
          await tx
            .insert(settings)
            .values({ key: input.key, value: input.value });
          refuse(REFUSALS.notInReview);
        },
      },
    );
    expect(await answer).toEqual({ ok: false, ...REFUSALS.notInReview });
    expect(
      await stored("kit_refused"),
      "the write before the refusal is rolled back",
    ).toBeUndefined();
  });

  it("rolls back a transaction that returns a refusal rather than raising one", async () => {
    const { answer } = write(
      { key: "kit_returned", value: "x" },
      {
        transaction: async (tx, { input }) => {
          await tx
            .insert(settings)
            .values({ key: input.key, value: input.value });
          return { ok: false, ...REFUSALS.noRevokePending };
        },
      },
    );
    expect(await answer).toEqual({ ok: false, ...REFUSALS.noRevokePending });
    expect(await stored("kit_returned")).toBeUndefined();
  });

  it("runs the transaction once: SQLite answering busy fails the command, and nothing is written", async () => {
    // The database client already waited for its turn (src/lib/serialized-writes.ts); a retry would wait again.
    const busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    let attempts = 0;
    const { answer } = write(
      { key: "kit_busy", value: "x" },
      {
        transaction: async (tx, { input }) => {
          attempts += 1;
          await tx
            .insert(settings)
            .values({ key: input.key, value: input.value });
          throw busy;
        },
      },
    );
    await expect(answer).rejects.toBe(busy);
    expect(attempts).toBe(1);
    expect(await stored("kit_busy")).toBeUndefined();
  });

  it("throws a bug, from the transaction or from authorize, and writes nothing", async () => {
    const bug = new Error("a bug");
    await expect(
      write(
        { key: "kit_bug", value: "x" },
        {
          transaction: async (tx, { input }) => {
            await tx
              .insert(settings)
              .values({ key: input.key, value: input.value });
            throw bug;
          },
        },
      ).answer,
    ).rejects.toBe(bug);
    expect(await stored("kit_bug")).toBeUndefined();
    await expect(
      write(
        { key: "kit_bug", value: "x" },
        {
          authorize: () => {
            throw bug;
          },
        },
      ).answer,
    ).rejects.toBe(bug);
  });
});
