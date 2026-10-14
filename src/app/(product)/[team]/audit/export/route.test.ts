import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { Viewer } from "@/domain/types";
import { refusal } from "@/server/api/reads";
import { getAuditExport } from "@/server/queries/audit";
import { getViewer } from "@/server/viewer";
import { GET } from "./route";

// The route is thin: the viewer and the export are mocked (the export is shaped in src/server/queries/audit.test.ts
// and decided by the audit service, src/server/services/contract/audit.ts), and these tests check what the route
// makes of the answer: the file with its headers, or a refusal in the shape every refusal has, with its status.
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/queries/audit", () => ({ getAuditExport: vi.fn() }));

const viewer = { userId: "taylor" } as Viewer;

function get(team: string, query = "") {
  const request = new NextRequest(
    `http://localhost/${team}/audit/export${query}`,
  );
  return GET(request, { params: Promise.resolve({ team }) } as Parameters<
    typeof GET
  >[1]);
}

beforeEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(viewer);
  vi.mocked(getAuditExport).mockReset();
});

describe("GET /[team]/audit/export", () => {
  it("answers the file: CSV with a BOM for Excel, as an attachment, not cached", async () => {
    vi.mocked(getAuditExport).mockResolvedValue({
      ok: true,
      filename: "stencil-audit-all-2026-10-04.csv",
      csv: "When,Who\r\n",
      count: 1,
    });
    const res = await get("all");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="stencil-audit-all-2026-10-04.csv"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Audit-Count")).toBe("1");
    // The bytes, not res.text(), which strips the BOM that makes Excel read the file as UTF-8.
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      ...new TextEncoder().encode("﻿When,Who\r\n"),
    ]);
  });

  it("passes the viewer, the team and the page's filters to the export", async () => {
    vi.mocked(getAuditExport).mockResolvedValue({
      ok: true,
      filename: "f.csv",
      csv: "",
      count: 0,
    });
    await get("all", "?person=riley&action=access");
    expect(getAuditExport).toHaveBeenCalledWith(
      expect.objectContaining({ viewer }),
      "all",
      { person: "riley", action: "access" },
    );
  });

  it("is a 401 when nobody is signed in, and asks for nothing", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    const res = await get("all");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "signed_out" });
    expect(getAuditExport).not.toHaveBeenCalled();
  });

  it.each([
    [403, REASONS.generic, "generic", "You don't have access to do this."],
    [
      404,
      REQUEST_REFUSALS.spaceUnavailable,
      "space_unavailable",
      "This team isn't available to you.",
    ],
  ] as const)(
    "a %i is {ok:false, code, reason} as JSON, never a file",
    async (status, entry, code, reason) => {
      vi.mocked(getAuditExport).mockResolvedValue(refusal(status, entry));
      const res = await get("coral-offers");

      expect(res.status).toBe(status);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("Content-Disposition")).toBeNull();
      expect(await res.json()).toEqual({ ok: false, code, reason });
    },
  );
});
