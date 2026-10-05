import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportOriginalView } from "@/domain/import-types";
import type { Viewer } from "@/domain/types";
import { getImportOriginalView } from "@/server/queries/import";
import { getViewer } from "@/server/viewer";
import { GET } from "./route";

// Thin route: the viewer and the query are mocked (the query is tested in src/server/import/create.test.ts).
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/queries/import", () => ({ getImportOriginalView: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;
const view: ImportOriginalView = {
  ref: { uploadId: "up_abcdefghjk", filename: "notes.txt", kind: "txt", size: 5, uploadedAt: "2026-10-04T13:00:00.000Z", uploadedByName: "Maya Chen" },
  source: { kind: "txt", text: "hello" },
  report: {
    kind: "txt",
    filename: "notes.txt",
    size: 5,
    nameFrom: "filename",
    placeholders: [],
    skippedPlaceholders: [],
    sections: { matched: [], added: [] },
    counts: { headings: 0, paragraphs: 1, lists: 0, tables: 0 },
    dropped: [],
  },
  lines: { detected: [], dropped: [], kept: [] },
};

const get = (id = "up_abcdefghjk") =>
  GET(new Request(`http://localhost/api/imports/${id}/view`) as NextRequest, { params: Promise.resolve({ uploadId: id }) });

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(getImportOriginalView).mockReset();
});

describe("GET /api/imports/[uploadId]/view", () => {
  it("200 with the view as JSON, not cached", async () => {
    vi.mocked(getImportOriginalView).mockResolvedValue(view);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual(view);
    expect(getImportOriginalView).toHaveBeenCalledWith(viewer, "up_abcdefghjk");
  });

  it("404 when the query finds nothing the viewer may see", async () => {
    vi.mocked(getImportOriginalView).mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
