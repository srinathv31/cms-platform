// Cross-channel parity, per golden case. Plain assertions: unlike the golden files, `vitest -u` and
// `npm run golden:update` cannot approve any of this away.
//
//   - the web page, the email HTML, the email text and the PDF show the same content as the RenderDoc
//     (markers, blank lines and links included), and the PDF has no glyph the font could not draw;
//   - the RenderDoc keeps its own invariants (docs/render-spec.md section 9);
//   - a case named `error-*` fails before any channel, and `pdf-error-*` renders everything but the PDF;
//   - the PDF carries the render time as its dates; the same input gives the same bytes again.

import { beforeAll, describe, expect, it } from "vitest";
import { caseSlugs, readInput } from "./files";
import { renderDocProblems } from "./invariants";
import { expectedFiles, nodeFiles, parityProblems, runCase, type CaseRun } from "./pipeline";

describe.each(caseSlugs())("parity %s", (slug) => {
  let run: CaseRun;

  beforeAll(async () => {
    run = await runCase(readInput(slug));
  }, 60_000);

  it("fails, or renders, as the case promises", () => {
    if (slug.startsWith("error-")) {
      expect(run.error, "this case must be refused before any channel renders").not.toBeNull();
      expect(run.pdf).toBeNull();
    } else {
      expect(run.error, "this case must render").toBeNull();
      if (slug.startsWith("pdf-error-")) {
        expect(run.pdf?.ok, "the PDF must be refused (no tofu, no silent drops)").toBe(false);
      } else expect(run.pdf?.ok, run.pdf && !run.pdf.ok ? `the PDF failed: ${run.pdf.error.message}` : "").toBe(true);
    }
  });

  it("the RenderDoc keeps its invariants", () => {
    expect(renderDocProblems(run.blocks)).toEqual([]);
  });

  it("every channel shows the RenderDoc's content", () => {
    expect(parityProblems(run).join("\n")).toBe("");
  });

  it("the PDF is stamped with the render time", () => {
    if (!run.pdf?.ok) return;
    const stamp = new Date(run.input.at).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    expect(run.pdf.extract.info.CreationDate).toBe(stamp);
    expect(run.pdf.extract.info.ModDate).toBe(stamp);
  });

  it("gives the same bytes again", async () => {
    const again = await runCase(readInput(slug));
    expect(expectedFiles(again)).toEqual(expectedFiles(run));
    expect(nodeFiles(again)).toEqual(nodeFiles(run));
    if (run.pdf?.ok && again.pdf?.ok) expect(Buffer.compare(Buffer.from(again.pdf.bytes), Buffer.from(run.pdf.bytes))).toBe(0);
  }, 60_000);
});
