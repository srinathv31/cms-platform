import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportOriginalRef } from "@/domain/import-types";
import type { Viewer } from "@/domain/types";
import { getImportOriginalFile } from "@/server/queries/import";
import { getViewer } from "@/server/viewer";
import { GET } from "./route";

// Thin route: the viewer and the query are mocked (the query is tested in src/server/import/create.test.ts).
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/queries/import", () => ({ getImportOriginalFile: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;
const ref: ImportOriginalRef = {
  uploadId: "up_abcdefghjk",
  filename: "Spring (final) offer’s.pdf",
  kind: "pdf",
  size: 4,
  uploadedAt: "2026-10-04T13:00:00.000Z",
  uploadedByName: "Maya Chen",
};

const get = (id = "up_abcdefghjk") =>
  GET(new Request(`http://localhost/api/imports/${id}/file`) as NextRequest, { params: Promise.resolve({ uploadId: id }) });

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(getImportOriginalFile).mockReset();
});

describe("GET /api/imports/[uploadId]/file", () => {
  it("serves the bytes inline with the kind's type, an RFC 5987 file name and no caching", async () => {
    vi.mocked(getImportOriginalFile).mockResolvedValue({ ref, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''Spring%20%28final%29%20offer%E2%80%99s.pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(getImportOriginalFile).toHaveBeenCalledWith(viewer, "up_abcdefghjk");
  });

  it("text originals are served as UTF-8 text", async () => {
    vi.mocked(getImportOriginalFile).mockResolvedValue({ ref: { ...ref, kind: "txt" }, bytes: new Uint8Array([0x61]) });
    expect((await get()).headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("404 when the query finds nothing the viewer may see", async () => {
    vi.mocked(getImportOriginalFile).mockResolvedValue(null);
    const res = await get("up_0000000000");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
