import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "./repo-path";

const win = path.win32;
const ROOT = "C:\\work\\stencil";

describe("repoPath", () => {
  it("uses / between folders on Windows, as git does", () => {
    expect(repoPath(ROOT, "C:\\work\\stencil\\docs\\README.md", win)).toBe(
      "docs/README.md",
    );
    expect(
      repoPath(ROOT, "C:\\work\\stencil\\src\\app\\(product)\\[team]", win),
    ).toBe("src/app/(product)/[team]");
  });

  it("matches the path git lists for what a doc names with /", () => {
    // checkPath in scripts/docs-check.ts joins the root and a doc's `src/server/README.md`.
    expect(repoPath(ROOT, win.join(ROOT, "src/server/README.md"), win)).toBe(
      "src/server/README.md",
    );
    expect(
      repoPath(ROOT, win.resolve(ROOT, "docs/guides", "../README.md"), win),
    ).toBe("docs/README.md");
  });

  it("ignores the case of a Windows drive and folders, and names the root as an empty string", () => {
    expect(
      repoPath("c:\\WORK\\Stencil", "C:\\work\\stencil\\e2e\\a.ts", win),
    ).toBe("e2e/a.ts");
    expect(repoPath(ROOT, ROOT, win)).toBe("");
  });

  it("leaves a path outside the root recognisable", () => {
    expect(repoPath(ROOT, "C:\\work\\other\\a.md", win)).toBe("../other/a.md");
    expect(repoPath(ROOT, "D:\\x\\a.md", win)).toBe("D:/x/a.md");
  });

  it("keeps a backslash in a POSIX file name", () => {
    expect(
      repoPath("/work/stencil", "/work/stencil/docs/a\\b.md", path.posix),
    ).toBe("docs/a\\b.md");
    expect(
      repoPath("/work/stencil", "/work/stencil/docs/README.md", path.posix),
    ).toBe("docs/README.md");
  });
});
