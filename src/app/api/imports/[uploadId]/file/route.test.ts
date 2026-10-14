import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_MIME } from "@/domain/import-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { refusal } from "@/server/services/results";
import { getViewer } from "@/server/viewer";
import { GET } from "./route";

// Thin route: the viewer and the template service are mocked (the service is tested in
// src/server/services/contract/templates.ts, and against the local files in services/local/templates.test.ts).
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
const importOriginal = vi.hoisted(() => vi.fn());
vi.mock("@/server/services", () => ({
  services: () => ({ templates: { importOriginal } }),
}));

const viewer = { userId: "maya" } as Viewer;

const get = (id = "up_abcdefghjk") =>
  GET(new Request(`http://localhost/api/imports/${id}/file`) as NextRequest, {
    params: Promise.resolve({ uploadId: id }),
  });

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  importOriginal.mockReset();
});

describe("GET /api/imports/[uploadId]/file", () => {
  it("serves the bytes inline with the type the backend kept, an RFC 5987 file name and no caching", async () => {
    importOriginal.mockResolvedValue({
      ok: true,
      filename: "Spring (final) offer’s.pdf",
      mime: IMPORT_MIME.pdf,
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(res.headers.get("Content-Disposition")).toBe(
      "inline; filename*=UTF-8''Spring%20%28final%29%20offer%E2%80%99s.pdf",
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    expect(importOriginal).toHaveBeenCalledWith(
      expect.objectContaining({ viewer }),
      { uploadId: "up_abcdefghjk" },
    );
  });

  it("text originals are served as UTF-8 text", async () => {
    importOriginal.mockResolvedValue({
      ok: true,
      filename: "notes.txt",
      mime: IMPORT_MIME.txt,
      bytes: new Uint8Array([0x61]),
    });
    expect((await get()).headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("404 when the backend finds nothing the viewer may see", async () => {
    importOriginal.mockResolvedValue(
      refusal(404, REQUEST_REFUSALS.uploadUnavailable),
    );
    const res = await get("up_0000000000");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      ok: false,
      code: "upload_unavailable",
      reason: "This file isn't available.",
    });
  });

  it("401 when nobody is signed in, without asking the backend", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      code: "signed_out",
      reason: "Sign in to continue.",
    });
    expect(importOriginal).not.toHaveBeenCalled();
  });
});
