// The golden pipeline in one place: input.json -> every artifact. The golden test, the parity test and
// the update script all go through here, so a file on disk is always what the engine says today.
//
// A case runs the render engine (src/server/render/engine.ts: stages 6 to 9 of docs/render-spec.md
// section 1, the same code the render route runs) on its input, once per channel the case enables
// (`channels`), and a push once per platform: validate the values, check the document or the fields,
// resolve, then the channel's adapter. When a run fails before its adapter (stages 6-8) the case ends
// with `error` and nothing is rendered; a PDF that cannot be drawn is `pdf.ok === false` with the error
// the route would return, and a push or SMS over its limit carries its error, while the other channels
// still render.

import { smsLength } from "@/domain/messages/gsm7";
import { PUSH_PLATFORMS, pushPayloadBytes, type PushPlatform } from "@/domain/messages/push";
import type { EmailRender, PushRender, RenderBlock, RenderDoc, RenderError, RenderTarget, SmsRender } from "@/domain/render/types";
import { CHANNELS } from "@/domain/types";
import { runEngine, type EngineResult } from "@/server/render/engine";
import { engineInput, json, type RenderFixture } from "@/server/render/testing/fixture";
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

/** A message channel's run: what the route returns on a 200, or the error it refuses with (422). */
export type MessageOutcome<T> = { ok: true; output: T } | { ok: false; error: RenderError };

export interface CaseRun {
  input: RenderFixture;
  /** Set when the case fails before any channel (stage 6, 7 or 8); then nothing below exists. */
  error: RenderError | null;
  /** The resolved document, when a document channel (PDF, web, email) ran and rendered. */
  doc: RenderDoc | null;
  blocks: RenderBlock[];
  /** The web page; "" when the case doesn't render web. */
  web: string;
  email: EmailRender | null;
  pdf: PdfOutcome | null;
  /** The push for each platform, when the case renders push. */
  push: Record<PushPlatform, MessageOutcome<PushRender>> | null;
  sms: MessageOutcome<SmsRender> | null;
  /** The content text, derived from the RenderDoc alone (`expected/content.txt`). */
  ref: Content;
}

const emptyContent: Content = { lines: [], links: [] };

/**
 * Every run a case's channels ask for, in `CHANNELS` order and a push once per platform. The PDF runs
 * first, so a body the check or the resolver refuses reads as a request for the PDF would see it ("The
 * PDF couldn't be rendered. …"); only the email run checks the subject and preheader, so a refused
 * field reads as the email's.
 */
function targetsOf(input: RenderFixture): RenderTarget[] {
  return CHANNELS.filter((channel) => input.channels.includes(channel)).flatMap((channel): RenderTarget[] =>
    channel === "push" ? PUSH_PLATFORMS.map((platform) => ({ channel, platform })) : [{ channel }],
  );
}

/** "push.ios", "sms", "pdf": a run's name, as its files are named. */
const runName = (target: RenderTarget) => (target.channel === "push" ? `push.${target.platform}` : target.channel);

export async function runCase(input: RenderFixture): Promise<CaseRun> {
  const at = new Date(input.at);
  const runs = new Map<string, EngineResult>();
  for (const target of targetsOf(input)) {
    const result = await runEngine(engineInput(input), target, at);
    // Refused before the adapter (values, the document check, resolution): nothing renders.
    if (!result.ok && result.stage < 9) {
      return { input, error: result.error, doc: null, blocks: [], web: "", email: null, pdf: null, push: null, sms: null, ref: emptyContent };
    }
    runs.set(runName(target), result);
  }

  // The web and email adapters take any RenderDoc: a failure there is a bug, not an outcome.
  const web = runs.get("web");
  const email = runs.get("email");
  const pdf = runs.get("pdf");
  if (web && !web.ok) throw web.cause;
  if (email && !email.ok) throw email.cause;
  let doc: RenderDoc | null = null;
  for (const result of [web, email, pdf]) {
    if (result?.ok) {
      doc = result.doc;
      break;
    }
  }
  const message = <T>(result: EngineResult): MessageOutcome<T> =>
    result.ok ? { ok: true, output: result.body as T } : { ok: false, error: result.error };
  return {
    input,
    error: null,
    doc,
    blocks: doc?.blocks ?? [],
    web: web?.ok ? (web.body as string) : "",
    email: email?.ok ? (email.body as EmailRender) : null,
    pdf: !pdf
      ? null
      : pdf.ok
        ? { ok: true, bytes: pdf.body as Uint8Array, extract: await extractPdf(pdf.body as Uint8Array) }
        : { ok: false, error: pdf.error },
    push: input.channels.includes("push")
      ? (Object.fromEntries(PUSH_PLATFORMS.map((p) => [p, message<PushRender>(runs.get(`push.${p}`)!)])) as CaseRun["push"])
      : null,
    sms: runs.has("sms") ? message<SmsRender>(runs.get("sms")!) : null,
    ref: doc ? contentFromRenderDoc(doc.blocks) : emptyContent,
  };
}

// ── The files ────────────────────────────────────────────────────────────────

/** A message run's file: `<name>.json` with the route's 200 body, or `<name>.error.json` with its error. */
function messageFile<T>(name: string, outcome: MessageOutcome<T>): Record<string, string> {
  return outcome.ok ? { [`${name}.json`]: json(outcome.output) } : { [`${name}.error.json`]: json(outcome.error) };
}

/** Everything the engine-neutral `expected/` folder holds for this run (file name -> contents). */
export function expectedFiles(run: CaseRun): Record<string, string> {
  if (run.error) return { "error.json": json(run.error) };
  const files: Record<string, string> = {};
  if (run.doc) {
    files["renderdoc.json"] = json(run.doc);
    files["content.txt"] = run.ref.lines.join("\n") + "\n";
    files["links.json"] = json(run.ref.links);
  }
  if (run.input.channels.includes("web")) files["web.html"] = run.web;
  if (run.email) {
    files["email.html"] = run.email.html;
    files["email.json"] = json({ subject: run.email.subject, preheader: run.email.preheader });
    files["email.txt"] = run.email.text;
  }
  for (const platform of PUSH_PLATFORMS) if (run.push) Object.assign(files, messageFile(`push.${platform}`, run.push[platform]));
  if (run.sms) Object.assign(files, messageFile("sms", run.sms));
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

/**
 * Cross-channel content problems for a run: [] when every channel shows what the RenderDoc says (a
 * document), or the message's platforms and measurements agree (a message).
 */
export function parityProblems(run: CaseRun): string[] {
  if (run.error) return [];
  return [...messageProblems(run), ...documentProblems(run)];
}

/**
 * A message's own parity: Android's push is iPhone's without the subtitle, word for word; each push's
 * payloadBytes is its platform's JSON measured again; the SMS's encoding, parts and characters are its
 * text measured again, and the text ends with the content type's footer on its own line.
 */
function messageProblems(run: CaseRun): string[] {
  const problems: string[] = [];
  if (run.push) {
    const { ios, android } = run.push;
    if (ios.ok && android.ok) {
      if (ios.output.title !== android.output.title) problems.push("push: the title differs between iPhone and Android");
      if (ios.output.body !== android.output.body) problems.push("push: the body differs between iPhone and Android");
    }
    if (android.ok && "subtitle" in android.output) problems.push("push.android: has a subtitle");
    for (const platform of PUSH_PLATFORMS) {
      const push = run.push[platform];
      if (push.ok && push.output.payloadBytes !== pushPayloadBytes(platform, push.output)) {
        problems.push(`push.${platform}: payloadBytes isn't the size of its notification JSON`);
      }
    }
  }
  if (run.sms?.ok) {
    const { text, encoding, parts, characters } = run.sms.output;
    const measured = smsLength(text);
    if (encoding !== measured.encoding || parts !== measured.parts || characters !== measured.characters) {
      problems.push("sms: encoding, parts or characters don't match its text");
    }
    const footer = run.input.smsFooter;
    if (footer && !(text === footer || text.endsWith(`\n${footer}`))) problems.push("sms: the footer isn't on its own last line");
  }
  return problems;
}

/** A document's parity: every channel that rendered shows the RenderDoc's content. */
function documentProblems(run: CaseRun): string[] {
  if (!run.email) return [];
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
