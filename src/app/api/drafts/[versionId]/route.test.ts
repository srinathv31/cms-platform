import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftSaveResponse, Viewer } from "@/domain/types";
import { MAX_BODY_SIZE } from "@/server/drafts/parse-patch";
import { draftAccessRefusal, saveDraft } from "@/server/drafts/save-draft";
import { getViewer } from "@/server/viewer";
import { PUT } from "./route";

// The route is thin: these tests mock the viewer, the access check and the save, and check the order
// (access before the body), the capped body read, the parsing and the HTTP mapping. The access check
// and the save are tested against a real database in src/server/drafts/apply-patch.test.ts.
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/drafts/save-draft", () => ({ saveDraft: vi.fn(), draftAccessRefusal: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;
const SESSION = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";
const good = { rev: 4, sessionKey: SESSION, name: "Annual fee waiver" };
const TOO_LARGE = { ok: false, error: "invalid", message: "The draft is too large to save." };

function requestOf(body: BodyInit, headers: Record<string, string> = {}, id = "v_abc") {
  return new Request(`http://localhost/api/drafts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit) as NextRequest;
}

function send(request: NextRequest, id = "v_abc") {
  return PUT(request, { params: Promise.resolve({ versionId: id }) });
}

function put(body: unknown, headers: Record<string, string> = {}, id = "v_abc") {
  return send(requestOf(typeof body === "string" ? body : JSON.stringify(body), headers, id), id);
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

const answerWith = (response: DraftSaveResponse) => vi.mocked(saveDraft).mockResolvedValue(response);

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(draftAccessRefusal).mockReset().mockResolvedValue(null);
  vi.mocked(saveDraft).mockReset();
});

describe("PUT /api/drafts/[versionId]", () => {
  it("200 with the new rev and the saved time", async () => {
    answerWith({ ok: true, rev: 5, savedAt: "2026-10-04T10:00:00.000Z" });
    const res = await put(good);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, rev: 5, savedAt: "2026-10-04T10:00:00.000Z" });
    expect(saveDraft).toHaveBeenCalledWith(viewer, "v_abc", good);
  });

  it("passes the version id from the URL", async () => {
    answerWith({ ok: true, rev: 1, savedAt: "x" });
    await put(good, {}, "v_other");
    expect(vi.mocked(saveDraft).mock.calls[0]![1]).toBe("v_other");
  });

  it.each([
    ["not_found", 404],
    ["forbidden", 403],
    ["not_draft", 409],
    ["conflict", 409],
    ["invalid", 400],
  ] as const)("%s from the save becomes %i, with the body unchanged", async (error, status) => {
    const body: DraftSaveResponse = { ok: false, error, message: "words", ...(error === "conflict" ? { rev: 9 } : {}) };
    answerWith(body);
    const res = await put(good);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("400 invalid for a body that isn't JSON, without touching the save", async () => {
    const res = await put("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid", message: "The request body is not valid JSON." });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("400 invalid for a bad shape, naming the field", async () => {
    const res = await put({ ...good, rev: "four" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string; message: string };
    expect(json).toMatchObject({ ok: false, error: "invalid" });
    expect(json.message).toMatch(/^rev /);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("400 invalid for a patch with nothing in it", async () => {
    const res = await put({ rev: 4, sessionKey: SESSION });
    expect(res.status).toBe(400);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("400 invalid for an empty name, before any database work", async () => {
    const res = await put({ ...good, name: "   " });
    expect(res.status).toBe(400);
    expect(saveDraft).not.toHaveBeenCalled();
  });

});

describe("PUT /api/drafts/[versionId]: access before the body", () => {
  it.each([
    ["forbidden", 403, "You don't have access to do this."],
    ["not_found", 404, "This draft no longer exists."],
  ] as const)("%s is answered (%i) before a byte of the body is read", async (error, status, message) => {
    vi.mocked(draftAccessRefusal).mockResolvedValue({ ok: false, error, message });
    const { stream, pulled } = chunkedBody(64);
    const request = requestOf(stream, {}, "v_theirs");
    const res = await send(request, "v_theirs");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, error, message });
    expect(draftAccessRefusal).toHaveBeenCalledWith(viewer, "v_theirs");
    expect(request.bodyUsed).toBe(false);
    expect(pulled.mb).toBeLessThanOrEqual(1); // at most what the stream queued up front
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("forbidden wins over a body that isn't JSON, and over one declared too large", async () => {
    vi.mocked(draftAccessRefusal).mockResolvedValue({ ok: false, error: "forbidden", message: "You don't have access to do this." });
    const notJson = await put("{not json");
    expect(notJson.status).toBe(403);
    expect(await notJson.json()).toMatchObject({ error: "forbidden" });
    expect((await put(good, { "Content-Length": String(MAX_BODY_SIZE + 1) })).status).toBe(403);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});

describe("PUT /api/drafts/[versionId]: the body cap", () => {
  it("413 when Content-Length says the body is too large, before reading it", async () => {
    const request = requestOf(JSON.stringify(good), { "Content-Length": String(MAX_BODY_SIZE + 1) });
    const res = await send(request);
    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(TOO_LARGE);
    expect(request.bodyUsed).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("413 for a chunked body with no Content-Length, as soon as it passes the limit: the rest is never read", async () => {
    const { stream, pulled } = chunkedBody(64);
    const res = await send(requestOf(stream));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(TOO_LARGE);
    expect(pulled.mb).toBeLessThan(5); // the limit is 2,000,000 bytes: two 1 MB chunks and a bit
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("413 for a body one byte over the limit; a body at the limit is read and parsed", async () => {
    expect((await put(" ".repeat(MAX_BODY_SIZE + 1))).status).toBe(413);
    const json = JSON.stringify(good);
    answerWith({ ok: true, rev: 5, savedAt: "x" });
    const res = await put(json + " ".repeat(MAX_BODY_SIZE - json.length));
    expect(res.status).toBe(200);
    expect(saveDraft).toHaveBeenCalledWith(viewer, "v_abc", good);
  });

  it("counts bytes, not characters", async () => {
    // 700,000 three-byte characters: 2.1 MB, though the string is shorter than the limit.
    const res = await put({ ...good, name: "€".repeat(700_000) });
    expect(res.status).toBe(413);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
