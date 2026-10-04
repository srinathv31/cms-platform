import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftSaveResponse, Viewer } from "@/domain/types";
import { MAX_BODY_SIZE } from "@/server/drafts/parse-patch";
import { saveDraft } from "@/server/drafts/save-draft";
import { getViewer } from "@/server/viewer";
import { PUT } from "./route";

// The route is thin: these tests mock the viewer and the save, and check the parsing and the HTTP mapping.
// The save itself is tested against a real database in src/server/drafts/apply-patch.test.ts.
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/drafts/save-draft", () => ({ saveDraft: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;
const SESSION = "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21";
const good = { rev: 4, sessionKey: SESSION, name: "Annual fee waiver" };

function put(body: unknown, headers: Record<string, string> = {}, id = "v_abc") {
  const request = new Request(`http://localhost/api/drafts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as NextRequest;
  return PUT(request, { params: Promise.resolve({ versionId: id }) });
}

const answerWith = (response: DraftSaveResponse) => vi.mocked(saveDraft).mockResolvedValue(response);

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
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
    expect(getViewer).not.toHaveBeenCalled();
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

  it("400 invalid when Content-Length says the body is too large", async () => {
    const res = await put(good, { "Content-Length": String(MAX_BODY_SIZE + 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid", message: "The draft is too large to save." });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("400 invalid when the text read is too large", async () => {
    const res = await put(" ".repeat(MAX_BODY_SIZE + 1));
    expect(res.status).toBe(400);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
