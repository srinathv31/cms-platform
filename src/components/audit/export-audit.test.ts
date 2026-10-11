import { describe, expect, it, vi } from "vitest";
import { EXPORT_FAILED, requestAuditExport } from "./export-audit";

// The Export link's fetch: the file as sent, or the refusal the route answered (`{ ok: false, code, reason }`,
// branched on by its code), or `failed` when there is no usable answer.

const HREF = "/all/audit/export?person=riley";

function answering(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

const csv = (headers: Record<string, string> = {}) =>
  new Response("﻿When,Who\r\n", {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="stencil-audit-all-2026-10-04.csv"', ...headers },
  });

const refusal = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("requestAuditExport", () => {
  it("asks for the href as it is, uncached, and returns the file's bytes under the name the server gave", async () => {
    const fetchImpl = answering(csv());
    const result = await requestAuditExport(HREF, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(HREF, { cache: "no-store" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.filename).toBe("stencil-audit-all-2026-10-04.csv");
    // The bytes as sent, the BOM Excel reads as UTF-8 included (Blob.text() would strip it).
    const bytes = [...new Uint8Array(await result.blob.arrayBuffer())];
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes).toEqual([...new TextEncoder().encode("﻿When,Who\r\n")]);
  });

  it("falls back to a name of its own when the server sent none", async () => {
    const result = await requestAuditExport(HREF, answering(csv({ "Content-Disposition": "attachment" })));
    expect(result).toMatchObject({ ok: true, filename: "stencil-audit.csv" });
  });

  it.each([
    [403, { ok: false, code: "generic", reason: "You don't have access to do this." }],
    [404, { ok: false, code: "space_unavailable", reason: "This team isn't available to you." }],
  ] as const)("returns a %i refusal as it is, code and reason", async (status, body) => {
    expect(await requestAuditExport(HREF, answering(refusal(status, body)))).toEqual(body);
  });

  it("is `failed` with the screen's own sentence when there is no usable answer", async () => {
    const failed = { ok: false, code: "failed", reason: EXPORT_FAILED };
    expect(await requestAuditExport(HREF, answering(new TypeError("Failed to fetch")))).toEqual(failed);
    expect(await requestAuditExport(HREF, answering(new Response("<html>Bad gateway</html>", { status: 502 })))).toEqual(failed);
    expect(await requestAuditExport(HREF, answering(refusal(403, { error: "forbidden" })))).toEqual(failed);
    expect(await requestAuditExport(HREF, answering(refusal(500, { ok: false })))).toEqual(failed);
  });
});
