import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, describe, expect, it } from "vitest";
import { fileUrlOfPath, filePathOfUrl } from "./file-url";

// The Windows cases run on any machine: `path.win32` resolves and joins as Windows does. They assert the
// URL libSQL needs (parsed by hand against @libsql/core's `parseUri`: `file:C:/dir/app.db` gives the path
// `C:/dir/app.db`, which Windows opens); the POSIX block at the end opens real files.

const win = path.win32;
const posix = path.posix;
const WIN_CWD = "C:\\work\\stencil";
const POSIX_CWD = "/work/stencil";

describe("filePathOfUrl", () => {
  it("resolves a relative path against the working directory", () => {
    expect(filePathOfUrl("file:./data/e2e-0.db", POSIX_CWD, posix)).toBe(
      "/work/stencil/data/e2e-0.db",
    );
    expect(filePathOfUrl("file:./data/e2e-0.db", WIN_CWD, win)).toBe(
      "C:\\work\\stencil\\data\\e2e-0.db",
    );
    expect(filePathOfUrl("file:data\\e2e-0.db", WIN_CWD, win)).toBe(
      "C:\\work\\stencil\\data\\e2e-0.db",
    );
  });

  it("takes an absolute path as it is, with or without the // and an empty or localhost host", () => {
    for (const url of [
      "file:/data/app.db",
      "file:///data/app.db",
      "file://localhost/data/app.db",
    ])
      expect(filePathOfUrl(url, POSIX_CWD, posix)).toBe("/data/app.db");
  });

  it("reads every spelling of a Windows drive path", () => {
    for (const url of [
      "file:C:\\data\\app.db",
      "file:C:/data/app.db",
      "file:/C:/data/app.db",
      "file:///C:/data/app.db",
    ])
      expect(filePathOfUrl(url, WIN_CWD, win)).toBe("C:\\data\\app.db");
  });

  it("decodes escapes, so a folder named with # ? or % survives", () => {
    expect(
      filePathOfUrl("file:C:/Code/C%23/50%25/app%3F.db", WIN_CWD, win),
    ).toBe("C:\\Code\\C#\\50%\\app?.db");
    expect(filePathOfUrl("file:/tmp/a%20b/app.db", POSIX_CWD, posix)).toBe(
      "/tmp/a b/app.db",
    );
  });

  it("returns null for what is not a plain file URL, so the caller passes it on", () => {
    for (const url of [
      "libsql://stencil.example.com",
      "http://localhost:8080",
      ":memory:",
      "file:./app.db?mode=ro",
      "file:./app.db#frag",
      "file://server/share/app.db",
      "file:./100%.db",
    ])
      expect(filePathOfUrl(url, POSIX_CWD, posix)).toBeNull();
  });
});

describe("fileUrlOfPath", () => {
  it("keeps a POSIX path as it is after file:", () => {
    expect(fileUrlOfPath("/work/stencil/data/e2e-0.db", posix)).toBe(
      "file:/work/stencil/data/e2e-0.db",
    );
  });

  it("puts the drive letter right after file: and uses / between folders on Windows", () => {
    expect(fileUrlOfPath("C:\\work\\stencil\\data\\e2e-0.db", win)).toBe(
      "file:C:/work/stencil/data/e2e-0.db",
    );
    expect(fileUrlOfPath("C:\\Users\\Jo Smith\\code\\app.db", win)).toBe(
      "file:C:/Users/Jo Smith/code/app.db",
    );
  });

  it("escapes %, # and ?", () => {
    expect(fileUrlOfPath("/code/C#/50%/what?.db", posix)).toBe(
      "file:/code/C%23/50%25/what%3F.db",
    );
    expect(fileUrlOfPath("C:\\code\\C#\\app.db", win)).toBe(
      "file:C:/code/C%23/app.db",
    );
  });

  it("round-trips through filePathOfUrl on both systems", () => {
    for (const [file, api] of [
      ["C:\\Users\\Jo Smith\\C#\\100%\\app.db", win],
      ["D:\\data\\app.db", win],
      ["/home/jo smith/C#/100%/app.db", posix],
    ] as const)
      expect(filePathOfUrl(fileUrlOfPath(file, api), "/", api)).toBe(file);
  });
});

describe("with a real file (this machine's own path rules)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "file url #1 100% "));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("opens the database the URL names, whatever the folder is called", async () => {
    const file = path.join(dir, "app.db");
    const url = fileUrlOfPath(file);
    const first = createClient({ url });
    await first.execute("CREATE TABLE t (n INTEGER)");
    first.close();
    // The same URL reaches the same file again, with its table, and decodes back to the path.
    const again = createClient({ url });
    await expect(again.execute("SELECT count(*) FROM t")).resolves.toBeTruthy();
    again.close();
    expect(filePathOfUrl(url)).toBe(file);
  });
});
