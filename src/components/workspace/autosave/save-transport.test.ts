import { describe, expect, it, vi } from "vitest";
import type { DraftPatch, JSONContent } from "@/domain/types";
import { DOCUMENT_MESSAGES } from "@/editor/model/document-check";
import { KEEPALIVE_LIMIT_BYTES, createFetchSend } from "./save-transport";

const patch: DraftPatch = { rev: 3, sessionKey: "6f1c2b7e-4a0d-4f43-9a58-3a6a1f0f7b21", name: "Annual fee" };

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sendWith = (fetchImpl: typeof fetch) => createFetchSend("v_abc", fetchImpl);

describe("createFetchSend", () => {
  it("PUTs the patch as JSON to the draft's URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 4, savedAt: "2026-10-04T10:00:00.000Z" }));
    const result = await sendWith(fetchImpl)(patch, { keepalive: false });

    expect(result).toEqual({ ok: true, rev: 4, savedAt: "2026-10-04T10:00:00.000Z" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/drafts/v_abc");
    expect(init).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/json" }, keepalive: false });
    expect(JSON.parse(init!.body as string)).toEqual(patch);
  });

  it("escapes the version id in the URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 1, savedAt: "x" }));
    await createFetchSend("a/b c", fetchImpl)(patch, { keepalive: false });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/drafts/a%2Fb%20c");
  });

  it("uses keepalive when asked and the body is small", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 1, savedAt: "x" }));
    await sendWith(fetchImpl)(patch, { keepalive: true });
    expect(fetchImpl.mock.calls[0]![1]!.keepalive).toBe(true);
  });

  it("falls back to an ordinary request when the body is over the keepalive limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 1, savedAt: "x" }));
    const big: DraftPatch = { ...patch, name: "x".repeat(KEEPALIVE_LIMIT_BYTES + 1) };
    await sendWith(fetchImpl)(big, { keepalive: true });
    expect(fetchImpl.mock.calls[0]![1]!.keepalive).toBe(false);
  });

  it("counts bytes, not characters, against the limit", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 1, savedAt: "x" }));
    // 25,000 three-byte characters are 75,000 bytes but only 25,000 characters.
    await sendWith(fetchImpl)({ ...patch, name: "€".repeat(25_000) }, { keepalive: true });
    expect(fetchImpl.mock.calls[0]![1]!.keepalive).toBe(false);
  });

  it("never asks for keepalive unless the scheduler did", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 1, savedAt: "x" }));
    await sendWith(fetchImpl)(patch, { keepalive: false });
    expect(fetchImpl.mock.calls[0]![1]!.keepalive).toBe(false);
  });

  it("returns the route's refusals as answers, not errors", async () => {
    for (const [status, error] of [
      [400, "invalid"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [409, "not_draft"],
    ] as const) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(status, { ok: false, error, message: "m", rev: 9 }));
      await expect(sendWith(fetchImpl)(patch, { keepalive: false })).resolves.toEqual({ ok: false, error, message: "m", rev: 9 });
    }
  });

  it("refuses a document the server's check would refuse, with its sentence and without a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(200, { ok: true, rev: 4, savedAt: "x" }));
    const list = (start: number): JSONContent => ({
      type: "doc",
      content: [{ type: "orderedList", attrs: { start }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }],
    });
    await expect(sendWith(fetchImpl)({ ...patch, body: list(20_000) }, { keepalive: false })).resolves.toEqual({
      ok: false,
      error: "invalid",
      message: DOCUMENT_MESSAGES.listStart,
    });
    const subject: JSONContent = { type: "doc", content: [{ type: "heading", attrs: { level: 1 } }, { type: "paragraph" }] };
    await expect(sendWith(fetchImpl)({ ...patch, "email.subject": subject }, { keepalive: false })).resolves.toMatchObject({
      ok: false,
      error: "invalid",
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    // What normalization fixes (a heading level 5 becomes 3) is sent as usual; the server normalizes it.
    const heading: JSONContent = { type: "doc", content: [{ type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "x" }] }] };
    await sendWith(fetchImpl)({ ...patch, body: heading }, { keepalive: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects when the network fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(sendWith(fetchImpl)(patch, { keepalive: false })).rejects.toThrow("Failed to fetch");
  });

  it("rejects on a server error, even one with a JSON body", async () => {
    for (const body of ["<html>Internal Server Error</html>", { ok: false, error: "conflict", message: "m" }]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(500, body));
      await expect(sendWith(fetchImpl)(patch, { keepalive: false })).rejects.toThrow(/500/);
    }
  });

  it("rejects when a 2xx or 4xx body isn't one of the route's answers", async () => {
    for (const [status, body] of [
      [200, "<html>login</html>"],
      [200, { ok: true }],
      [200, { ok: true, rev: "4", savedAt: "x" }],
      [404, "<html>Not found</html>"],
      [409, { ok: false, error: "teapot", message: "m" }],
      [400, null],
    ] as const) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(reply(status, body));
      await expect(sendWith(fetchImpl)(patch, { keepalive: false })).rejects.toThrow();
    }
  });
});
