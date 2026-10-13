import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { COMMENT_REFUSALS, canComment } from "@/domain/comments";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { now } from "@/server/clock";
import type { Db } from "@/server/db/client";
import { settings } from "@/server/db/schema/ucomp";
import { freshDatabasePerTest } from "@/server/testing/review-fixtures";
import { getViewer } from "@/server/viewer";
import { check, permit, refuse, serverAction, type ActionSteps } from "./kit";

// The server action kit (handoff review A3, H1): every action's shape, run once. Against a temporary
// migrated database; the clock and the viewer are swapped. The writes go to `settings`, a plain
// key-value table, so a rolled-back write is easy to see.

const env = vi.hoisted(() => ({ now: new Date("2026-10-09T12:00:00.000Z") }));

vi.mock("@/server/db/client", async () => {
  const { tempDatabase } = await import("@/server/testing/review-fixtures");
  return tempDatabase("ucomp-action-kit-");
});
vi.mock("@/server/clock", () => ({ now: vi.fn(async () => env.now) }));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

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

let db: Db;

freshDatabasePerTest();

beforeAll(async () => {
  ({ db } = await import("@/server/db/client"));
});

beforeEach(() => {
  vi.mocked(getViewer).mockResolvedValue(admin);
  vi.mocked(now).mockClear();
});

const Input = z.object({ key: z.string().min(1).max(32), value: z.string() });
type Input = z.infer<typeof Input>;

const stored = async (key: string) =>
  (await db.select().from(settings).where(eq(settings.key, key)))[0]?.value;

/** An action that writes the input to `settings`, as Platform Admin, with the steps given swapped in. */
function write(
  raw: unknown,
  over: Partial<ActionSteps<Input, void, { key: string }>> = {},
) {
  return serverAction<Input, void, { key: string }>(raw, {
    input: Input,
    authorize: ({ viewer }) =>
      check(viewer, "platform.manage", { teamId: null }),
    transaction: async (tx, { input }) => {
      await tx.insert(settings).values({ key: input.key, value: input.value });
      return { ok: true, key: input.key };
    },
    ...over,
  });
}

describe("serverAction", () => {
  it("runs the steps in order and answers the transaction's result", async () => {
    const order: string[] = [];
    const after = vi.fn();
    const result = await write(
      { key: "kit_ok", value: "written" },
      {
        authorize: ({ viewer, input }) => {
          order.push(`authorize ${viewer.userId} ${input.key}`);
          check(viewer, "platform.manage", { teamId: null });
        },
        transaction: async (tx, { input, now: at }) => {
          order.push(`transaction at ${at.toISOString()}`);
          await tx
            .insert(settings)
            .values({ key: input.key, value: input.value });
          return { ok: true, key: input.key };
        },
        after: (answer, { now: at }) => {
          order.push("after");
          after(answer, at);
        },
      },
    );
    expect(result).toEqual({ ok: true, key: "kit_ok" });
    expect(order).toEqual([
      "authorize riley kit_ok",
      `transaction at ${env.now.toISOString()}`,
      "after",
    ]);
    expect(after).toHaveBeenCalledWith({ ok: true, key: "kit_ok" }, env.now);
    expect(await stored("kit_ok")).toBe("written");
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("refuses input that doesn't parse, before authorize runs or the clock is read", async () => {
    const authorize = vi.fn();
    expect(await write({ key: "", value: "x" }, { authorize })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(await write(undefined, { authorize })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("answers input that doesn't parse with the action's own refusal, fixed or from the parser's problem", async () => {
    expect(
      await write({ key: 7 }, { invalid: REQUEST_REFUSALS.notificationGone }),
    ).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.notificationGone,
    });
    const worded = await write(
      { key: "" },
      {
        invalid: (error) =>
          REQUEST_REFUSALS.invalidInput(error.issues[0]?.message),
      },
    );
    expect(worded).toMatchObject({ ok: false, code: "invalid_input" });
    if (worded.ok) return;
    expect(worded.reason).not.toBe(REQUEST_REFUSALS.invalidInput().reason);
  });

  it("returns a permission refusal from `check`, and writes nothing", async () => {
    vi.mocked(getViewer).mockResolvedValue(author);
    const after = vi.fn();
    expect(
      await write({ key: "kit_forbidden", value: "x" }, { after }),
    ).toEqual({ ok: false, ...REASONS.generic });
    expect(await stored("kit_forbidden")).toBeUndefined();
    expect(after).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("returns a domain rule's refusal through `permit`", async () => {
    vi.mocked(getViewer).mockResolvedValue(author);
    const active = { state: "active" as const, stageApproverIds: [] };
    expect(
      await write(
        { key: "kit_permit", value: "x" },
        {
          authorize: ({ viewer }) =>
            permit(canComment(viewer, { teamId: "t_coral", version: active })),
        },
      ),
    ).toEqual({ ok: false, ...COMMENT_REFUSALS.closed });
    expect(await stored("kit_permit")).toBeUndefined();
  });

  it("returns a refusal raised inside the transaction, rolled back, instead of throwing", async () => {
    const after = vi.fn();
    const result = await write(
      { key: "kit_refused", value: "x" },
      {
        transaction: async (tx, { input }) => {
          await tx
            .insert(settings)
            .values({ key: input.key, value: input.value });
          refuse(REFUSALS.notInReview);
        },
        after,
      },
    );
    expect(result).toEqual({ ok: false, ...REFUSALS.notInReview });
    expect(
      await stored("kit_refused"),
      "the write before the refusal is rolled back",
    ).toBeUndefined();
    expect(after).not.toHaveBeenCalled();
  });

  it("rolls back a transaction that returns a refusal rather than raising one", async () => {
    const result = await write(
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
    expect(result).toEqual({ ok: false, ...REFUSALS.noRevokePending });
    expect(await stored("kit_returned")).toBeUndefined();
  });

  it("runs the transaction once: SQLite answering busy fails the action, and nothing is written", async () => {
    // The database client already waited for its turn (src/lib/serialized-writes.ts); a retry would wait again.
    const busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    let attempts = 0;
    await expect(
      write(
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
      ),
    ).rejects.toBe(busy);
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
      ),
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
      ),
    ).rejects.toBe(bug);
  });

  it("lets what `after` throws through, as Next's redirect must be, once the write has committed", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/somewhere;307;",
    });
    await expect(
      write(
        { key: "kit_redirect", value: "x" },
        {
          after: () => {
            throw redirect;
          },
        },
      ),
    ).rejects.toBe(redirect);
    expect(await stored("kit_redirect")).toBe("x");
  });

  it("refuses when nobody is signed in, before the input is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null as unknown as Viewer);
    const authorize = vi.fn();
    expect(
      await write({ key: "kit_signed_out", value: "x" }, { authorize }),
    ).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.signedOut,
    });
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("serverAction with a service call", () => {
  it("calls the service with the request context and the parsed input, then runs `after` on ok", async () => {
    const after = vi.fn();
    const call = vi.fn(async () => ({ ok: true as const, key: "done" }));
    expect(
      await serverAction(
        { key: "k", value: "v", extra: 1 },
        {
          input: Input,
          call,
          after,
        },
      ),
    ).toEqual({ ok: true, key: "done" });
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ viewer: admin }),
      { key: "k", value: "v" },
    );
    expect(after).toHaveBeenCalledWith(
      { ok: true, key: "done" },
      expect.objectContaining({ input: { key: "k", value: "v" } }),
    );
    // The backend dates its own writes: the BFF reads no clock for it.
    expect(now).not.toHaveBeenCalled();
  });

  it("answers the service's refusal as it is, without `after`", async () => {
    const after = vi.fn();
    expect(
      await serverAction(
        { key: "k", value: "v" },
        {
          input: Input,
          call: async () => ({ ok: false, ...REFUSALS.notInReview }),
          after,
        },
      ),
    ).toEqual({ ok: false, ...REFUSALS.notInReview });
    expect(after).not.toHaveBeenCalled();
  });

  it("refuses input that doesn't parse, and when nobody is signed in, without calling the service", async () => {
    const call = vi.fn();
    expect(await serverAction({ key: "" }, { input: Input, call })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    vi.mocked(getViewer).mockResolvedValue(null as unknown as Viewer);
    expect(
      await serverAction({ key: "k", value: "v" }, { input: Input, call }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.signedOut });
    expect(call).not.toHaveBeenCalled();
  });

  it("lets a thrown error through: a bug or an outage, not a refusal", async () => {
    const outage = new Error("backend unreachable");
    await expect(
      serverAction(
        { key: "k", value: "v" },
        {
          input: Input,
          call: async () => {
            throw outage;
          },
        },
      ),
    ).rejects.toBe(outage);
  });
});
