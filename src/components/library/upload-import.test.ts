import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS, IMPORT_REFUSALS } from "@/domain/import-types";
import { precheckImport, precheckImportBytes } from "./upload-import";

describe("precheckImport", () => {
  it("lets .docx, .pdf and .txt files through, whatever the case", () => {
    expect(precheckImport({ name: "Spring offer.docx", size: 10 })).toBeNull();
    expect(precheckImport({ name: "notice.PDF", size: 10 })).toBeNull();
    expect(precheckImport({ name: "notes.txt", size: 10 })).toBeNull();
  });

  it("refuses other kinds with the server's sentence, and a legacy .doc with the way forward", () => {
    expect(precheckImport({ name: "offer.doc", size: 10 })).toBe(IMPORT_REFUSALS.legacyDoc);
    expect(IMPORT_REFUSALS.legacyDoc).toMatch(/Save it as \.docx first\.$/);
    expect(precheckImport({ name: "photo.png", size: 10 })).toBe(IMPORT_REFUSALS.type);
    expect(precheckImport({ name: "docx", size: 10 })).toBe(IMPORT_REFUSALS.type);
  });

  it("refuses an empty file and one over the size limit", () => {
    expect(precheckImport({ name: "a.txt", size: 0 })).toBe(IMPORT_REFUSALS.empty);
    expect(precheckImport({ name: "a.pdf", size: IMPORT_LIMITS.maxBytes + 1 })).toBe(IMPORT_REFUSALS.size);
    expect(precheckImport({ name: "a.pdf", size: IMPORT_LIMITS.maxBytes })).toBeNull();
  });
});

describe("precheckImportBytes", () => {
  const file = (name: string, bytes: number[]) => new File([new Uint8Array(bytes)], name);

  it("refuses a .pdf that doesn't start %PDF and a .docx that isn't a zip, unsent", async () => {
    expect(await precheckImportBytes(file("a.pdf", [0x89, 0x50, 0x4e, 0x47]))).toBe(IMPORT_REFUSALS.notPdf);
    expect(await precheckImportBytes(file("a.docx", [0x25, 0x50, 0x44, 0x46]))).toBe(IMPORT_REFUSALS.notWord);
  });

  it("lets the real ones through, and leaves .txt to the server", async () => {
    expect(await precheckImportBytes(file("a.PDF", [0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull();
    expect(await precheckImportBytes(file("a.docx", [0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(await precheckImportBytes(file("a.txt", [0x00, 0x01]))).toBeNull();
  });
});
