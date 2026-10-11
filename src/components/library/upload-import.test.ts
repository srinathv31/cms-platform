import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_LIMITS, IMPORT_REFUSALS } from "@/domain/import-types";
import { IMPORT_FAILED, precheckImport, precheckImportBytes, uploadImport } from "./upload-import";

describe("precheckImport", () => {
  it("lets .docx, .pdf and .txt files through, whatever the case", () => {
    expect(precheckImport({ name: "Spring offer.docx", size: 10 })).toBeNull();
    expect(precheckImport({ name: "notice.PDF", size: 10 })).toBeNull();
    expect(precheckImport({ name: "notes.txt", size: 10 })).toBeNull();
  });

  it("refuses other kinds with the server's sentence, and a legacy .doc with the way forward", () => {
    expect(precheckImport({ name: "offer.doc", size: 10 })).toBe(IMPORT_REFUSALS.legacyDoc.reason);
    expect(IMPORT_REFUSALS.legacyDoc.reason).toMatch(/Save it as \.docx first\.$/);
    expect(precheckImport({ name: "photo.png", size: 10 })).toBe(IMPORT_REFUSALS.type.reason);
    expect(precheckImport({ name: "docx", size: 10 })).toBe(IMPORT_REFUSALS.type.reason);
  });

  it("refuses an empty file and one over the size limit", () => {
    expect(precheckImport({ name: "a.txt", size: 0 })).toBe(IMPORT_REFUSALS.empty.reason);
    expect(precheckImport({ name: "a.pdf", size: IMPORT_LIMITS.maxBytes + 1 })).toBe(IMPORT_REFUSALS.size.reason);
    expect(precheckImport({ name: "a.pdf", size: IMPORT_LIMITS.maxBytes })).toBeNull();
  });
});

describe("precheckImportBytes", () => {
  const file = (name: string, bytes: number[]) => new File([new Uint8Array(bytes)], name);

  it("refuses a .pdf that doesn't start %PDF and a .docx that isn't a zip, unsent", async () => {
    expect(await precheckImportBytes(file("a.pdf", [0x89, 0x50, 0x4e, 0x47]))).toBe(IMPORT_REFUSALS.notPdf.reason);
    expect(await precheckImportBytes(file("a.docx", [0x25, 0x50, 0x44, 0x46]))).toBe(IMPORT_REFUSALS.notWord.reason);
  });

  it("lets the real ones through, and leaves .txt to the server", async () => {
    expect(await precheckImportBytes(file("a.PDF", [0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull();
    expect(await precheckImportBytes(file("a.docx", [0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(await precheckImportBytes(file("a.txt", [0x00, 0x01]))).toBeNull();
  });
});

describe("uploadImport", () => {
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));

  afterEach(() => vi.unstubAllGlobals());

  it("posts the file to the team's import route and returns the new template", async () => {
    answer(200, { ok: true, templateId: "UC-4F7K2Q", href: "/coral-offers/templates/UC-4F7K2Q" });
    expect(await uploadImport(file, "coral-offers")).toEqual({ ok: true, templateId: "UC-4F7K2Q", href: "/coral-offers/templates/UC-4F7K2Q" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/imports?team=coral-offers");
    expect(init?.method).toBe("POST");
  });

  it("returns the route's refusals as they are: the code to branch on and the sentence to show", async () => {
    for (const [status, entry] of [
      [413, IMPORT_REFUSALS.size],
      [415, IMPORT_REFUSALS.legacyDoc],
      [400, IMPORT_REFUSALS.pdfLocked],
    ] as const) {
      answer(status, { ok: false, code: entry.code, reason: entry.reason });
      expect(await uploadImport(file, "coral-offers")).toEqual({ ok: false, code: entry.code, reason: entry.reason });
    }
    answer(403, { ok: false, code: "generic", reason: "You don't have access to do this." });
    expect(await uploadImport(file, "coral-offers")).toEqual({ ok: false, code: "generic", reason: "You don't have access to do this." });
  });

  it("is the code `failed` with the screen's own sentence when the answer isn't one of the route's", async () => {
    for (const [status, body] of [
      [502, "<html>Bad gateway</html>"],
      [500, {}],
      [404, { error: "not_found" }],
      [400, { ok: false }],
      [200, { ok: true }],
    ] as const) {
      answer(status, body);
      expect(await uploadImport(file, "coral-offers"), `${status} ${JSON.stringify(body)}`).toEqual({
        ok: false,
        code: "failed",
        reason: IMPORT_FAILED,
      });
    }
  });
});
