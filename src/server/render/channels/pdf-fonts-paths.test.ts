import { existsSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { describe, expect, it, vi } from "vitest";
import { registerFonts } from "./pdf-fonts";

// The font files are handed to react-pdf as paths. It opens a string `src` as a file unless it looks like a
// URL, so on Windows the path must stay what `path.join` makes of it (`C:\work\stencil\node_modules\…`), never
// a `file:` URL or a `//…` path (pdf-fonts.ts says why). This test reads what the adapter registers on whatever
// machine runs it.

describe("registerFonts", () => {
  it("gives react-pdf eight absolute paths of files that exist, none of them shaped like a URL", () => {
    const register = vi.spyOn(Font, "register");
    registerFonts();
    const sources = register.mock.calls.flatMap(([entry]) =>
      "fonts" in entry ? entry.fonts.map((face) => face.src) : [entry.src],
    );
    register.mockRestore();

    expect(sources).toHaveLength(8);
    for (const src of sources) {
      expect(path.isAbsolute(src), src).toBe(true);
      expect(existsSync(src), src).toBe(true);
      expect(src.startsWith(process.cwd()), src).toBe(true);
      expect(src, "react-pdf would fetch this").not.toMatch(/^(?:\w+:)?\/\//);
      expect(path.normalize(src), "native separators").toBe(src);
    }
  });
});
