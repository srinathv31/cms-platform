import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportOriginalView } from "@/domain/import-types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { getImportOriginalView } from "@/server/queries/import";
import { refusal } from "@/server/services/results";
import { getViewer } from "@/server/viewer";
import { GET } from "./route";

// Thin route: the viewer and the read model are mocked (the read model is tested in src/server/import/create.test.ts
// and src/server/queries/import.test.ts, the service in src/server/services/contract/templates.ts).
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/queries/import", () => ({ getImportOriginalView: vi.fn() }));

const viewer = { userId: "maya" } as Viewer;
const view: ImportOriginalView = {
  ref: {
    uploadId: "up_abcdefghjk",
    filename: "notes.txt",
    kind: "txt",
    size: 5,
    uploadedAt: "2026-10-04T13:00:00.000Z",
    uploadedByName: "Maya Chen",
  },
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
  GET(new Request(`http://localhost/api/imports/${id}/view`) as NextRequest, {
    params: Promise.resolve({ uploadId: id }),
  });

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(getImportOriginalView).mockReset();
});

describe("GET /api/imports/[uploadId]/view", () => {
  it("200 with the view as JSON, not cached", async () => {
    vi.mocked(getImportOriginalView).mockResolvedValue({ ok: true, view });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual(view);
    expect(getImportOriginalView).toHaveBeenCalledWith(
      expect.objectContaining({ viewer }),
      "up_abcdefghjk",
    );
  });

  it("404 when the backend finds nothing the viewer may see", async () => {
    vi.mocked(getImportOriginalView).mockResolvedValue(
      refusal(404, REQUEST_REFUSALS.uploadUnavailable),
    );
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      ok: false,
      code: "upload_unavailable",
      reason: "This file isn't available.",
    });
  });

  it("401 when nobody is signed in, without reading anything", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      code: "signed_out",
      reason: "Sign in to continue.",
    });
    expect(getImportOriginalView).not.toHaveBeenCalled();
  });
});
