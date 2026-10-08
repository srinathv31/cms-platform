// Same inputs, same bytes, whatever the process rendered before (docs/render-spec.md §12). The
// golden and parity tests render each case in one long-lived process, where every render shares the
// fonts' caches, so a case can only be compared with itself. Here every golden case, in every
// channel, plus probes that would leave state behind (a soft hyphen, leading no-break spaces,
// characters that share a glyph with another, a character the PDF can't draw), render in two fresh
// processes in opposite orders, and every output must be identical.

import { describe, expect, it } from "vitest";
import type { RenderDoc } from "@/domain/render/types";
import type { Channel } from "@/domain/types";
import type { RenderFixture } from "@/server/render/testing/fixture";
import { renderInFreshProcess, type FreshJob, type FreshResult } from "@/server/render/testing/fresh-process";
import { doc, h, p, t } from "@/server/render/testing/tiptap";
import { caseSlugs, readInput } from "./files";

const CHANNELS: readonly Channel[] = ["pdf", "web", "email"];
const AT = "2027-03-04T12:00:00.000Z";

const probe = (name: string, body: RenderFixture["body"]): FreshJob => ({
  name: `probe ${name}`,
  channel: "pdf",
  input: {
    templateId: "UC-PROBE",
    templateName: "Probe",
    versionNumber: 1,
    at: AT,
    variables: [],
    values: {},
    body,
    emailSubject: null,
    emailPreheader: null,
  },
});

/** The adapter alone: text the resolver would have changed reaches the PDF as given. */
const adapterProbe = (name: string, text: string): FreshJob => {
  const pdfDoc: RenderDoc = {
    templateId: "UC-PROBE",
    templateName: "Probe",
    versionNumber: 1,
    blocks: [{ type: "paragraph", id: null, content: [{ type: "text", text }] }],
  };
  return { name: `probe adapter ${name}`, pdfDoc, at: AT };
};

const PROBES: FreshJob[] = [
  probe("soft hyphen", doc(p(t("Ver­sicherung 800-555-0100")))),
  probe("leading no-break spaces", doc(p(t("  Lead")), h(2, t("  Serif lead")))),
  probe("an unrenderable character", doc(p(t("Việt")))),
  adapterProbe("soft hyphen", "Ver­sicherung"),
  // Each shares a glyph with a character the footer or a case uses: · (U+00B7), ; and the fraction slash.
  adapterProbe("shared glyphs", "a∙b c;d 1∕2"),
];

const CASE_JOBS: FreshJob[] = caseSlugs().flatMap((slug) => {
  const input = readInput(slug);
  return CHANNELS.map((channel): FreshJob => ({ name: `${slug} ${channel}`, input, channel }));
});

const byName = (results: readonly FreshResult[]) => new Map(results.map((r) => [r.name, r]));

describe("determinism across processes", () => {
  it("renders every case and probe to the same output in fresh processes, in either order", async () => {
    const [forward, backward] = await Promise.all([
      renderInFreshProcess([...CASE_JOBS, ...PROBES]),
      renderInFreshProcess([...PROBES, ...[...CASE_JOBS].reverse()]),
    ]);
    const first = byName(forward);
    const second = byName(backward);
    const differing = [...first.keys()].filter((name) => JSON.stringify(first.get(name)) !== JSON.stringify(second.get(name)));
    expect(differing, "these outputs depend on what the process rendered before them").toEqual([]);
    expect(first.size).toBe(CASE_JOBS.length + PROBES.length);
  }, 180_000);
});
