import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS, refuse } from "@/domain/refusals";
import type { DraftSaveResponse, JSONContent } from "@/domain/types";
import { MAX_BODY_SIZE } from "@/server/drafts/parse-patch";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { PUT } from "./route";

// The autosave route as the BFF runs it, against the in-memory fake (decision 0068): what the route adds to
// `drafts.save` is the order (who is asking, then may they, then the body), the capped body read, the parse, the
// documents prepared for storage, and the HTTP answer. What the save decides (the rev, the lost response, the
// state, the channels, what it writes) is the contract suite's (src/server/services/contract/drafts.ts).

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

// The seed's open drafts of Annual Fee Waiver and Rate Change Heads-up (Coral Offers), Maya's; their ids are literals
// of the seed.
const DRAFT = "v_dw4w6br3dk";
const ALERT_DRAFT = "v_c5f0bnjvbf";
const SESSION = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";
const good = { rev: 4, sessionKey: SESSION, name: "Annual fee waiver" };
const TOO_LARGE = {
  ok: false,
  code: "draft_too_large",
  reason: "The draft is too large to save.",
};

function requestOf(
  body: BodyInit,
  headers: Record<string, string> = {},
  id = DRAFT,
) {
  return new Request(`http://localhost/api/drafts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit) as NextRequest;
}

function send(request: NextRequest, id = DRAFT) {
  return PUT(request, { params: Promise.resolve({ versionId: id }) });
}

function put(body: unknown, headers: Record<string, string> = {}, id = DRAFT) {
  return send(
    requestOf(
      typeof body === "string" ? body : JSON.stringify(body),
      headers,
      id,
    ),
    id,
  );
}

/** A body with no Content-Length (as a chunked request): `megabytes` of 1 MB chunks, counting what was pulled. */
function chunkedBody(megabytes: number) {
  const pulled = { mb: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.mb >= megabytes) return controller.close();
      pulled.mb += 1;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
    },
  });
  return { stream, pulled };
}

/** The save, watched; `answer` stands in for the backend's answer when given. */
function watchSave(answer?: DraftSaveResponse) {
  const spy = vi.spyOn(services().drafts, "save");
  if (answer) spy.mockResolvedValue(answer);
  return spy;
}

/** The draft's current rev, as the backend answers a save at a rev it doesn't have. */
async function currentRev(): Promise<number> {
  const res = await put({ ...good, rev: 0 });
  const body = (await res.json()) as DraftSaveResponse;
  if (body.ok || body.rev === undefined) throw new Error("expected a rev");
  return body.rev;
}

beforeEach(() => {
  backend.as("maya");
});

describe("PUT /api/drafts/[versionId]", () => {
  it("saves as the signed-in person and answers 200 with the new rev and the backend's time", async () => {
    const rev = await currentRev();
    backend.setClock(new Date("2026-10-04T12:05:00.000Z"));
    const res = await put({ ...good, rev });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      rev: rev + 1,
      savedAt: "2026-10-04T12:05:00.000Z",
    });
  });

  it("answers the backend's draft_changed with its current rev as 409, the body as it is", async () => {
    const res = await put({ ...good, rev: 0 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.draftChanged,
      rev: expect.any(Number),
    });
  });

  it("hands the backend the version from the URL, the person's context and the patch, its documents prepared", async () => {
    const save = watchSave({ ok: true, rev: 5, savedAt: "x" });
    const raw: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 5 },
          content: [{ type: "text", text: "Fees\t2027" }],
        },
      ],
    };
    await put({ ...good, body: raw, "email.subject": null }, {}, ALERT_DRAFT);
    const [ctx, input] = save.mock.calls[0]!;
    expect(ctx.viewer.userId).toBe("maya");
    expect(input.versionId).toBe(ALERT_DRAFT);
    expect(input.patch).toMatchObject({
      ...good,
      "email.subject": null,
      body: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { id: expect.any(String), level: 3 },
            content: [{ type: "text", text: "Fees 2027" }],
          },
        ],
      },
    });
  });

  it.each([
    [REQUEST_REFUSALS.versionGone, 404],
    [REASONS.generic, 403],
    [REQUEST_REFUSALS.versionNotDraft, 409],
    [REQUEST_REFUSALS.draftChanged, 409],
    [REQUEST_REFUSALS.invalidInput("words"), 400],
  ] as const)(
    "%j from the save becomes %i, with the body unchanged",
    async (entry, status) => {
      const body: DraftSaveResponse = {
        ...refuse(entry),
        ...(entry === REQUEST_REFUSALS.draftChanged ? { rev: 9 } : {}),
      };
      watchSave(body);
      const res = await put(good);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
    },
  );

  it("400 invalid for a body that isn't JSON, without asking the save", async () => {
    const save = watchSave();
    const res = await put("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid_input",
      reason: "The request body is not valid JSON.",
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("400 invalid for a bad shape, naming the field", async () => {
    const save = watchSave();
    const res = await put({ ...good, rev: "four" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; reason: string };
    expect(json.code).toBe("invalid_input");
    expect(json.reason).toMatch(/^rev /);
    expect(save).not.toHaveBeenCalled();
  });

  it("400 invalid for a patch with nothing in it, or an empty name", async () => {
    const save = watchSave();
    expect((await put({ rev: 4, sessionKey: SESSION })).status).toBe(400);
    expect((await put({ ...good, name: "   " })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it("400 invalid with the check's sentence for a document it refuses, without asking the save", async () => {
    const save = watchSave();
    const res = await put({
      ...good,
      body: {
        type: "doc",
        content: [{ type: "iframe", attrs: { src: "https://example.com" } }],
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid_input",
      reason: "This document has content Stencil doesn't support.",
    });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("PUT /api/drafts/[versionId]: who is asking, and may they, before the body", () => {
  it("401 signed_out when nobody is signed in, before a byte of the body is read", async () => {
    backend.signOut();
    const access = vi.spyOn(services().drafts, "saveAccess");
    const { stream, pulled } = chunkedBody(64);
    const request = requestOf(stream);
    const res = await send(request);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.signedOut,
    });
    expect(request.bodyUsed).toBe(false);
    expect(pulled.mb).toBeLessThanOrEqual(1);
    expect(access).not.toHaveBeenCalled();
  });

  it.each([
    ["the permission refusal (a viewer)", "sam", DRAFT, 403, REASONS.generic],
    ["version_gone", "maya", "v_missing", 404, REQUEST_REFUSALS.versionGone],
  ] as const)(
    "%s is answered before a byte of the body is read",
    async (_, userId, id, status, entry) => {
      backend.as(userId);
      const save = watchSave();
      const { stream, pulled } = chunkedBody(64);
      const request = requestOf(stream, {}, id);
      const res = await send(request, id);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ ok: false, ...entry });
      expect(request.bodyUsed).toBe(false);
      expect(pulled.mb).toBeLessThanOrEqual(1); // at most what the stream queued up front
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("a refused person wins over a body that isn't JSON, and over one declared too large", async () => {
    backend.as("jordan");
    const notJson = await put("{not json");
    expect(notJson.status).toBe(403);
    expect(await notJson.json()).toMatchObject({ ok: false, code: "generic" });
    expect(
      (await put(good, { "Content-Length": String(MAX_BODY_SIZE + 1) })).status,
    ).toBe(403);
  });
});

describe("PUT /api/drafts/[versionId]: the body cap", () => {
  it("413 when Content-Length says the body is too large, before reading it", async () => {
    const save = watchSave();
    const request = requestOf(JSON.stringify(good), {
      "Content-Length": String(MAX_BODY_SIZE + 1),
    });
    const res = await send(request);
    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(TOO_LARGE);
    expect(request.bodyUsed).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("413 for a chunked body with no Content-Length, as soon as it passes the limit: the rest is never read", async () => {
    const save = watchSave();
    const { stream, pulled } = chunkedBody(64);
    const res = await send(requestOf(stream));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(TOO_LARGE);
    expect(pulled.mb).toBeLessThan(5); // the limit is 2,000,000 bytes: two 1 MB chunks and a bit
    expect(save).not.toHaveBeenCalled();
  });

  it("413 for a body one byte over the limit; a body at the limit is read and parsed", async () => {
    expect((await put(" ".repeat(MAX_BODY_SIZE + 1))).status).toBe(413);
    const save = watchSave({ ok: true, rev: 5, savedAt: "x" });
    const json = JSON.stringify(good);
    const res = await put(json + " ".repeat(MAX_BODY_SIZE - json.length));
    expect(res.status).toBe(200);
    expect(save.mock.calls[0]![1]).toEqual({ versionId: DRAFT, patch: good });
  });

  it("counts bytes, not characters", async () => {
    const save = watchSave();
    // 700,000 three-byte characters: 2.1 MB, though the string is shorter than the limit.
    const res = await put({ ...good, name: "€".repeat(700_000) });
    expect(res.status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });
});
