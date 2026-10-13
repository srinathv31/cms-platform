import { refresh, revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMMENT_REFUSALS } from "@/domain/comments";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { DOCUMENT_THREAD } from "@/domain/review-types";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { addComment, reopenThread, reply, resolveThread } from "./comments";

// The comment actions as the BFF runs them, against the in-memory fake (decision 0068): what an action adds to its
// service is the input's parse, the answer's shape, and which pages refresh. What the service decides (who may
// comment where, the text's limits, the writes and who is told) is the contract suite's
// (src/server/services/contract/comments.ts), which holds the fake and the database to the same cases.
// Seed: Cash Back v3 round 2 is in review (Maya's); Jordan and Alex approve on Coral Offers.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

beforeEach(() => {
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

/** The version of Cash Back in review. */
async function versionInReview() {
  const ctx = backend.as("jordan");
  const history = await services().versions.history(ctx, {
    templateId: backend.templates["cash-back"]!,
  });
  if (!history.ok) throw new Error(history.code);
  return history.versions.find((v) => v.state === "in_review")!;
}

/** Jordan's whole-version thread on Cash Back v3. */
async function startThread() {
  const version = await versionInReview();
  const result = await addComment({
    templateId: backend.templates["cash-back"]!,
    versionId: version.id,
    blockId: DOCUMENT_THREAD,
    body: "Is the threshold still right?",
  });
  if (!result.ok) throw new Error(result.code);
  vi.mocked(refresh).mockClear();
  vi.mocked(revalidatePath).mockClear();
  return result.threadId;
}

/** The pages a comment shows on, refreshed once. */
function expectRefreshed() {
  expect(revalidatePath).toHaveBeenCalledWith(
    "/[team]/templates/[templateId]",
    "layout",
  );
  expect(revalidatePath).toHaveBeenCalledWith("/[team]/review", "layout");
  expect(refresh).toHaveBeenCalledTimes(1);
}

describe("addComment", () => {
  it("answers the new thread's id and refreshes the pages that show threads", async () => {
    const version = await versionInReview();
    expect(
      await addComment({
        templateId: backend.templates["cash-back"]!,
        versionId: version.id,
        blockId: DOCUMENT_THREAD,
        quote: "  spend $1,000  ",
        body: "  Is the $1,000 threshold still right?  ",
      }),
    ).toEqual({ ok: true, threadId: expect.stringMatching(/^th_/) });
    expectRefreshed();
  });

  it("sends the comment to the service as the input says it, the quote optional", async () => {
    const version = await versionInReview();
    const spy = vi.spyOn(services().comments, "add");
    await addComment({
      templateId: backend.templates["cash-back"]!,
      versionId: version.id,
      blockId: DOCUMENT_THREAD,
      body: "x",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        viewer: expect.objectContaining({ userId: "jordan" }),
      }),
      {
        templateId: backend.templates["cash-back"]!,
        versionId: version.id,
        blockId: DOCUMENT_THREAD,
        body: "x",
      },
    );
  });

  it("answers the service's refusal as it is, its sentence included, and refreshes nothing", async () => {
    const version = await versionInReview();
    expect(
      await addComment({
        templateId: backend.templates["cash-back"]!,
        versionId: version.id,
        blockId: DOCUMENT_THREAD,
        body: "  ",
      }),
    ).toEqual({ ok: false, ...COMMENT_REFUSALS.empty });
    expect(refresh).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses input that doesn't parse before asking the service", async () => {
    backend.as("jordan");
    const spy = vi.spyOn(services().comments, "add");
    expect(
      await addComment({
        templateId: "",
        versionId: "v_x",
        blockId: DOCUMENT_THREAD,
        body: "x",
      }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.invalidInput() });
    expect(
      await addComment({
        templateId: backend.templates["cash-back"]!,
        versionId: "v_x",
        blockId: "",
        body: "x",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(spy).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("answers signed_out when nobody is signed in", async () => {
    backend.signOut();
    expect(
      await addComment({
        templateId: backend.templates["cash-back"]!,
        versionId: "v_x",
        blockId: DOCUMENT_THREAD,
        body: "x",
      }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.signedOut });
  });
});

describe("reply", () => {
  it("answers { ok: true } and refreshes the pages that show threads", async () => {
    const threadId = await startThread();
    backend.as("maya");
    expect(await reply({ threadId, body: "Yes, confirmed." })).toEqual({
      ok: true,
    });
    expectRefreshed();
  });

  it("answers the service's refusal as it is and refreshes nothing", async () => {
    const threadId = await startThread();
    backend.as("sam");
    expect(await reply({ threadId, body: "x" })).toMatchObject({
      ok: false,
      code: "generic",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(await reply({ threadId: "", body: "x" })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
  });
});

describe("resolveThread and reopenThread", () => {
  it("answer { ok: true } and refresh the pages once the thread changed", async () => {
    const threadId = await startThread();
    backend.as("maya");
    expect(await resolveThread({ threadId })).toEqual({ ok: true });
    expectRefreshed();

    vi.mocked(refresh).mockClear();
    vi.mocked(revalidatePath).mockClear();
    expect(await reopenThread({ threadId })).toEqual({ ok: true });
    expectRefreshed();
  });

  it("answer { ok: true } and refresh nothing when the thread is as asked already (a second click)", async () => {
    const threadId = await startThread();
    backend.as("maya");
    await resolveThread({ threadId });
    vi.mocked(refresh).mockClear();
    vi.mocked(revalidatePath).mockClear();

    backend.as("jordan");
    expect(await resolveThread({ threadId })).toEqual({ ok: true });
    expect(await reopenThread({ threadId: await startThread() })).toEqual({
      ok: true,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answer the service's refusal as it is, and refuse input that doesn't parse", async () => {
    const threadId = await startThread();
    backend.as("eli");
    expect(await resolveThread({ threadId })).toMatchObject({
      ok: false,
      code: "generic",
    });
    expect(await reopenThread({ threadId })).toMatchObject({
      ok: false,
      code: "generic",
    });
    expect(await resolveThread({ threadId: "" })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
