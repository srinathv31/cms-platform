import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { getViewer } from "@/server/viewer";
import { refuse, serverAction } from "./kit";

// The server action kit (handoff review A3, H1): every action's shape, run once. No database and no clock: the
// kit reads the request context, parses, calls the service and runs `after`. What the service does with the
// call (the permission, the clock, the transaction) is the backend's, tested in the contract suite and, for the
// local implementation's command kit, in src/server/services/local/command.test.ts.

vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

const admin: Viewer = {
  userId: "riley",
  name: "Riley Chen",
  initials: "RC",
  title: "Platform Admin",
  platformRole: "platform_admin",
  memberships: [],
};

beforeEach(() => {
  vi.mocked(getViewer).mockResolvedValue(admin);
});

const Input = z.object({ key: z.string().min(1).max(32), value: z.string() });

describe("serverAction", () => {
  it("calls the service with the request context and the parsed input, then runs `after` on ok", async () => {
    const order: string[] = [];
    const call = vi.fn(async () => {
      order.push("call");
      return { ok: true as const, key: "done" };
    });
    const after = vi.fn(() => {
      order.push("after");
    });
    expect(
      await serverAction(
        { key: "k", value: "v", extra: 1 },
        { input: Input, call, after },
      ),
    ).toEqual({ ok: true, key: "done" });
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        viewer: admin,
        credential: { kind: "in_process", userId: "riley" },
        correlationId: expect.stringMatching(/^req_/),
      }),
      { key: "k", value: "v" },
    );
    expect(after).toHaveBeenCalledWith(
      { ok: true, key: "done" },
      expect.objectContaining({ input: { key: "k", value: "v" } }),
    );
    expect(order).toEqual(["call", "after"]);
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

  it("refuses input that doesn't parse with `invalid_input`, without calling the service", async () => {
    const call = vi.fn();
    expect(
      await serverAction({ key: "", value: "x" }, { input: Input, call }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.invalidInput() });
    expect(await serverAction(undefined, { input: Input, call })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("answers input that doesn't parse with the action's own refusal, fixed or from the parser's problem", async () => {
    const call = vi.fn();
    expect(
      await serverAction(
        { key: 7 },
        { input: Input, call, invalid: REQUEST_REFUSALS.notificationGone },
      ),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.notificationGone });
    const worded = await serverAction(
      { key: "" },
      {
        input: Input,
        call,
        invalid: (error) =>
          REQUEST_REFUSALS.invalidInput(error.issues[0]?.message),
      },
    );
    expect(worded).toMatchObject({ ok: false, code: "invalid_input" });
    if (worded.ok) return;
    expect(worded.reason).not.toBe(REQUEST_REFUSALS.invalidInput().reason);
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in, before the input is read or the service called", async () => {
    vi.mocked(getViewer).mockResolvedValue(null as unknown as Viewer);
    const call = vi.fn();
    const input = { safeParse: vi.fn() } as unknown as typeof Input;
    expect(
      await serverAction({ key: "k", value: "v" }, { input, call }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.signedOut });
    expect(input.safeParse).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("answers a refusal the call raises with `refuse`, without `after`", async () => {
    const after = vi.fn();
    expect(
      await serverAction(
        { key: "k", value: "v" },
        {
          input: Input,
          call: async () => refuse(REQUEST_REFUSALS.teamGone),
          after,
        },
      ),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.teamGone });
    expect(after).not.toHaveBeenCalled();
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

  it("lets what `after` throws through, as Next's redirect must be", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/somewhere;307;",
    });
    const call = vi.fn(async () => ({ ok: true as const }));
    await expect(
      serverAction(
        { key: "k", value: "v" },
        {
          input: Input,
          call,
          after: () => {
            throw redirect;
          },
        },
      ),
    ).rejects.toBe(redirect);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
