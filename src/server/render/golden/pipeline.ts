// The golden pipeline in one place: input.json -> every artifact. The golden test, the parity test and
// the update script all go through here, so a file on disk is always what the engine says today.
//
// A case runs the render engine (src/server/render/engine.ts: stages 6 to 9 of docs/render-spec.md
// section 1, the same code the render route runs) on its input, once per channel: validate the
// values, check the document, resolve, then the channel's adapter. When a channel's run fails before
// its adapter (stages 6-8) the case ends with `error` and nothing is rendered; a PDF that cannot be
// drawn is `pdf.ok === false` with the error the route would return, and the other channels still
// render.

import type { EmailRender, RenderBlock, RenderDoc, RenderError } from "@/domain/render/types";
import type { Channel } from "@/domain/types";
import { runEngine, type EngineResult } from "@/server/render/engine";
import { json, type RenderFixture } from "@/server/render/testing/fixture";
import {
  VIEWS,
  compareContent,
  contentFromHtml,
  contentFromPdf,
  contentFromRenderDoc,
  listMarkupProblems,
  plainTextProblems,
  verbatimFromHtml,
  verbatimFromRenderDoc,
  verbatimProblems,
  type Content,
} from "./content";
import { extractPdf, pdfContentBlocks, pdfLayoutText, type PdfExtract } from "./extract-pdf";

// ── Running a case ───────────────────────────────────────────────────────────

export type PdfOutcome = { ok: true; bytes: Uint8Array; extract: PdfExtract } | { ok: false; error: RenderError };

export interface CaseRun {
  input: RenderFixture;
  /** Set when the case fails before any channel (stage 6, 7 or 8); then nothing below exists. */
  error: RenderError | null;
  doc: RenderDoc | null;
  blocks: RenderBlock[];
  web: string;
  email: EmailRender | null;
  pdf: PdfOutcome | null;
  /** The content text, derived from the RenderDoc alone (`expected/content.txt`). */
  ref: Content;
}

const emptyContent: Content = { lines: [], links: [] };

/**
 * The PDF runs first, so a body the check or the resolver refuses reads as a request for the PDF
 * would see it ("The PDF couldn't be rendered. …"); only the email run checks the subject and
 * preheader, so a refused field reads as the email's.
 */
const CHANNELS: readonly Channel[] = ["pdf", "web", "email"];

export async function runCase(input: RenderFixture): Promise<CaseRun> {
  const at = new Date(input.at);
  const runs = {} as Record<Channel, EngineResult>;
  for (const channel of CHANNELS) {
    const result = await runEngine(input, channel, at);
    // Refused before the adapter (values, the document check, resolution): nothing renders.
    if (!result.ok && result.stage < 9) {
      return { input, error: result.error, doc: null, blocks: [], web: "", email: null, pdf: null, ref: emptyContent };
    }
    runs[channel] = result;
  }

  // The web and email adapters take any RenderDoc: a failure there is a bug, not an outcome.
  const { web, email, pdf } = runs;
  if (!web.ok) throw web.cause;
  if (!email.ok) throw email.cause;
  const doc = web.doc;
  return {
    input,
    error: null,
    doc,
    blocks: doc.blocks,
    web: web.body as string,
    email: email.body as EmailRender,
    pdf: pdf.ok
      ? { ok: true, bytes: pdf.body as Uint8Array, extract: await extractPdf(pdf.body as Uint8Array) }
      : { ok: false, error: pdf.error },
    ref: contentFromRenderDoc(doc.blocks),
  };
}

// ── The files ────────────────────────────────────────────────────────────────

/** Everything the engine-neutral `expected/` folder holds for this run (file name -> contents). */
export function expectedFiles(run: CaseRun): Record<string, string> {
  if (run.error) return { "error.json": json(run.error) };
  const files: Record<string, string> = {
    "renderdoc.json": json(run.doc),
    "web.html": run.web,
    "email.html": run.email!.html,
    "email.json": json({ subject: run.email!.subject, preheader: run.email!.preheader }),
    "email.txt": run.email!.text,
    "content.txt": run.ref.lines.join("\n") + "\n",
    "links.json": json(run.ref.links),
  };
  if (run.pdf?.ok) {
    const info = run.pdf.extract.info;
    files["pdf.meta.json"] = json({
      title: info.Title ?? null,
      subject: info.Subject ?? null,
      creator: info.Creator ?? null,
      producer: info.Producer ?? null,
      language: info.Language ?? null,
      creationDate: info.CreationDate ?? null,
      modDate: info.ModDate ?? null,
    });
  }
  return files;
}

/** What depends on the fonts and the layout engine: the Node PDF engine only. */
export function nodeFiles(run: CaseRun): Record<string, string> {
  if (run.error || !run.pdf) return {};
  if (!run.pdf.ok) return { "pdf.error.json": json(run.pdf.error) };
  const x = run.pdf.extract;
  return {
    "pdf.layout.txt": pdfLayoutText(x),
    "pdf.json": json({
      pageCount: x.pageCount,
      missingGlyphs: x.missingGlyphs,
      links: x.pages.flatMap((p, n) =>
        p.links.map((l) => ({ page: n + 1, url: l.url, text: l.text.replace(/[\u0001\u0003]/g, " ") })),
      ),
    }),
  };
}

// ── Parity ───────────────────────────────────────────────────────────────────

/** Cross-channel content problems for a run: [] when every channel shows what the RenderDoc says. */
export function parityProblems(run: CaseRun): string[] {
  if (run.error || !run.email) return [];
  const problems: string[] = [];
  problems.push(...compareContent("web", run.ref, contentFromHtml(run.web, ["main", "body"])));
  problems.push(...compareContent("email.html", run.ref, contentFromHtml(run.email.html, [".email-body", "body"])));
  problems.push(...plainTextProblems(run.blocks, run.email.text));
  if (run.pdf?.ok) {
    const x = run.pdf.extract;
    const ref = contentFromRenderDoc(run.blocks, VIEWS.pdf);
    const links = x.pages.flatMap((p) => p.links);
    problems.push(...compareContent("pdf", ref, contentFromPdf(pdfContentBlocks(x), links, ref), { pdf: true }));
    if (x.missingGlyphs) problems.push(`pdf: ${x.missingGlyphs} missing glyph(s) (U+0000): the font cannot draw some characters and the PDF was not refused`);
  }
  problems.push(...listMarkupProblems("web", run.web), ...listMarkupProblems("email.html", run.email.html));
  problems.push(
    ...verbatimProblems(
      verbatimFromRenderDoc(run.blocks),
      verbatimFromHtml(run.web, ["main", "body"]),
      verbatimFromHtml(run.email.html, [".email-body", "body"]),
    ),
  );
  return problems;
}
