import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { UPLOADS_SUBDIR, type ImportReport } from "@/domain/import-types";
import {
  kindOfPath,
  originalPath,
  readCompareHtml,
  readOriginal,
  readReport,
  removeUpload,
  resolveUploadsRoot,
  writeUpload,
} from "./store";

// The store keeps an upload's files under <root>/<uploadId>/. Two things must hold on Windows as on a Mac:
// the root resolves from either spelling of a path, and the id and the stored key (which the database
// keeps with "/" on every system) never reach the file system unchecked, since "\", ":" and ".." mean
// something there.

const ID = "up_abcdefghij";
const REPORT: ImportReport = {
  kind: "pdf",
  filename: "rate-change-notice.pdf",
  size: 8,
  pages: 1,
  nameFrom: "filename",
  placeholders: [],
  skippedPlaceholders: [],
  sections: { matched: [], added: [] },
  counts: { headings: 0, paragraphs: 1, lists: 0, tables: 0 },
  dropped: [],
};

describe("resolveUploadsRoot", () => {
  it("falls back to data/uploads under the working directory", () => {
    expect(resolveUploadsRoot("/work/stencil", undefined, path.posix)).toBe(
      "/work/stencil/data/uploads",
    );
    expect(resolveUploadsRoot("C:\\work\\stencil", "", path.win32)).toBe(
      "C:\\work\\stencil\\data\\uploads",
    );
    expect(UPLOADS_SUBDIR).toBe("data/uploads");
  });

  it("takes UPLOADS_DIR as written on the platform: absolute stays, relative joins the working directory", () => {
    expect(
      resolveUploadsRoot("C:\\work\\stencil", "D:\\blob\\uploads", path.win32),
    ).toBe("D:\\blob\\uploads");
    expect(
      resolveUploadsRoot(
        "C:\\work\\stencil",
        ".\\data\\e2e-uploads-1",
        path.win32,
      ),
    ).toBe("C:\\work\\stencil\\data\\e2e-uploads-1");
    expect(
      resolveUploadsRoot(
        "C:\\work\\stencil",
        "./data/e2e-uploads-1",
        path.win32,
      ),
    ).toBe("C:\\work\\stencil\\data\\e2e-uploads-1");
    expect(
      resolveUploadsRoot("/work/stencil", "./data/e2e-uploads-1", path.posix),
    ).toBe("/work/stencil/data/e2e-uploads-1");
  });
});

describe("the stored key", () => {
  it("always uses / between the folder and the file, on every system", () => {
    expect(originalPath(ID, "pdf")).toBe(`${ID}/original.pdf`);
    expect(originalPath(ID, "docx")).not.toContain("\\");
  });

  it("names a kind only for a key this store wrote", () => {
    expect(kindOfPath(`${ID}/original.txt`)).toBe("txt");
    for (const key of [
      `${ID}\\original.txt`,
      `${ID}/../${ID}/original.txt`,
      `../${ID}/original.txt`,
      `${ID}/original.txt:stream`,
      `${ID}/original.exe`,
      `/${ID}/original.txt`,
      `C:/${ID}/original.txt`,
      `${ID}/ORIGINAL.TXT`,
    ])
      expect(kindOfPath(key), key).toBeNull();
  });

  it("refuses an id that isn't one of ours before it becomes a path", async () => {
    for (const id of [
      "..",
      "up_abcdefghi",
      "up_abcdefghij/x",
      "up_abcdefghij\\x",
      "up_abcdefg:hi",
      "UP_ABCDEFGHIJ",
      "up_abcdefghij ",
    ]) {
      expect(() => originalPath(id, "pdf"), id).toThrow("Invalid upload id");
      await expect(readCompareHtml(id), id).rejects.toThrow(
        "Invalid upload id",
      );
    }
  });
});

describe("the files on disk", () => {
  const root = mkdtempSync(path.join(tmpdir(), "stencil uploads #1 "));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("writes, reads back and removes an upload, in a root whose name has spaces and a #", async () => {
    const bytes = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0x00, 0xff,
    ]);
    const stored = await writeUpload(
      {
        uploadId: ID,
        kind: "pdf",
        bytes,
        compareHtml: "<p>x</p>\r\n",
        report: REPORT,
      },
      root,
    );
    expect(stored).toBe(`${ID}/original.pdf`);
    expect(readdirSync(path.join(root, ID)).sort()).toEqual([
      "compare.html",
      "original.pdf",
      "report.json",
    ]);

    expect(await readOriginal(stored, root)).toEqual(bytes);
    expect(await readCompareHtml(ID, root)).toBe("<p>x</p>\r\n");
    expect(await readReport(ID, root)).toEqual(REPORT);

    await removeUpload(ID, root);
    expect(readdirSync(root)).toEqual([]);
    expect(await readOriginal(stored, root)).toBeNull();
    expect(await readReport(ID, root)).toBeNull();
    await removeUpload(ID, root); // already gone: no error
  });

  it("reads nothing for a key outside the folder layout", async () => {
    expect(await readOriginal(`..\\x\\original.pdf`, root)).toBeNull();
    expect(await readOriginal(`${ID}/../../etc/original.pdf`, root)).toBeNull();
  });
});
