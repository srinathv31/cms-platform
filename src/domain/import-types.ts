// Phase 7a contract (Track C): import a .docx, .pdf or .txt into a new draft, "Compare with original"
// (the rail's Original tab), the Copilot prompt, and the ⌘K palette's command model. Types and a few
// constants only, written by the lead; every 7a agent codes against this file. Dates in read models
// are ISO strings (they cross into client components).
//
// Who implements what is in docs/archive/phase-7a-brief.md. No schema change and no migration: the
// `uploads` table and `versions.import_upload_id` already exist (0000_init). If something here is
// wrong, make the smallest additive change and say so first in your report.

import type { Channel, ChannelFamily, JSONContent, RequiredSection, Variable, VersionState } from "./types";

// ── Files ────────────────────────────────────────────────────────────────────

export type ImportKind = "docx" | "pdf" | "txt";

export const IMPORT_LIMITS = {
  /** Upload size, checked before anything is parsed (413). */
  maxBytes: 10 * 1024 * 1024,
  /** PDFs longer than this are refused rather than half-imported. */
  maxPdfPages: 50,
  /** Characters of extracted text (all kinds). */
  maxChars: 200_000,
  /** The stored display name (the client's file name, sanitized). Never used in a path. */
  maxFilenameLength: 120,
  /** .docx images kept inline (data: URIs) in the Compare view, in total; beyond it they're left out there too. */
  maxCompareImageBytes: 2 * 1024 * 1024,
} as const;

/** The file input's `accept`. The server decides by sniffing the bytes, not by this or the MIME type. */
export const IMPORT_ACCEPT =
  ".docx,.pdf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/plain";

/** Stored `uploads.mime` and the Content-Type the original is served with. */
export const IMPORT_MIME: Record<ImportKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
};

/**
 * Why an import was refused: the one short line shown under the drop row (explain only when
 * blocked). Kinds are sniffed: docx = a zip holding word/document.xml; pdf = starts with "%PDF-";
 * txt = valid UTF-8 (a BOM is fine) with no NUL bytes and a .txt name. A legacy .doc is `legacyDoc`;
 * a file named .pdf or .docx whose bytes aren't one is `notPdf` / `notWord`; anything else is `type`.
 */
export const IMPORT_REFUSALS = {
  type: "Only .docx, .pdf and .txt files can be imported.",
  /** A legacy Word file (.doc): the one kind of refusal that has a way forward. */
  legacyDoc: "Only .docx, .pdf and .txt files can be imported. Save it as .docx first.",
  /** Named .pdf, but the bytes aren't a PDF. */
  notPdf: "This isn't a valid PDF.",
  /** Named .docx, but the bytes aren't a Word file. */
  notWord: "This isn't a valid Word file.",
  size: "This file is larger than 10 MB.",
  empty: "This file is empty.",
  unreadable: "Couldn't read this file.",
  tooLong: "This file has too much text to import.",
  pdfNoText: "This PDF has no text to import.",
  pdfLocked: "This PDF is password-protected.",
  pdfPages: "This PDF has more than 50 pages.",
  /**
   * The converted document fails the document check (docs/render-spec.md §3), e.g. a table whose
   * merged cells don't line up. The response's reason is this line, then the check's own sentence.
   */
  content: "This file can't be imported as it is.",
} as const;
export type ImportRefusalCode = keyof typeof IMPORT_REFUSALS;

/** Why Import a file isn't offered for an alert: a file's text becomes a body, and only a document has one. */
export const IMPORT_DOCUMENTS_ONLY = "Only documents can be imported.";

/**
 * Why a template of this family can't be made by importing a file, or null: import makes documents
 * (decision 0033). New template shows the Import row disabled with this reason while Alert is chosen.
 */
export function importUnavailable(family: ChannelFamily): string | null {
  return family === "document" ? null : IMPORT_DOCUMENTS_ONLY;
}

// ── Storage (./data/uploads stands in for Azure Blob) ────────────────────────
//
//   ./data/uploads/<uploadId>/original.<docx|pdf|txt>   the file exactly as uploaded
//   ./data/uploads/<uploadId>/compare.html              docx only: the allowlisted Compare view
//   ./data/uploads/<uploadId>/report.json               the ImportReport
//
// `uploadId` = newId("up"). `uploads.path` = "<uploadId>/original.<ext>", relative to the uploads
// root; the client's file name is stored in `uploads.filename` (display only, never a path).
// Files are written first, then ONE transaction inserts the template, its first draft (with
// `import_upload_id`), the uploads row (`template_id` set) and the audit event; if the transaction
// fails the upload's folder is removed. `resetDemo()` already empties the folder. Template removal
// in tests deletes only the row; leftover folders are harmless and go at the next reset.

export const UPLOADS_SUBDIR = "data/uploads";
export const ORIGINAL_BASENAME = "original";

// ── Placeholders → Text chips ────────────────────────────────────────────────
//
// A token is `{{inner}}` with no braces inside, found in a block's text with its text runs joined (a
// placeholder split by formatting, or by a PDF line wrap, is still one token; the chip takes the
// marks of the run it starts in). `inner` is trimmed, then:
//   1. already a valid key (`isValidKey`): key = inner.
//   2. a name: /^[A-Za-z][A-Za-z0-9 _.\-]*$/ and at most 64 characters: key = toKey(inner)
//      ("First Name" → first_name, "OfferEndDate" → offer_end_date). Must then pass isValidKey.
//   3. template logic (starts with # / ^ > ! & or "else", or contains | ( ) =): stays text, reported.
//   4. anything else (empty, symbols, too long): stays text, reported.
// Dedupe by key, in order of first use; every spelling is listed. Each key becomes ONE variable:
// { key, label: labelFromKey(key), type: "text", required: true, sample: "" }, and the draft's sample
// sets are `defaultSampleSets(variables, today)` (as a new template's are), so Preview works at once.
// Required: a new template has no consumers, so nothing is breaking yet (the editor's paste makes
// optional ones only because it lands in live templates).

export interface DetectedPlaceholder {
  key: string;
  label: string;
  /** The distinct spellings found, as written: "{{First Name}}", "{{first_name}}". */
  raw: string[];
  /** Chips made for this key. */
  count: number;
}

export interface SkippedPlaceholder {
  /** As written, e.g. "{{#if member}}". */
  raw: string;
  reason: "logic" | "invalid";
  count: number;
}

// ── Required sections ────────────────────────────────────────────────────────
//
// The content type's sections are found by text, in order: a top-level heading (any level), or a
// paragraph whose whole text is bold, matches section i when its normalized text (trimmed,
// lowercased, whitespace collapsed, leading numbering "1." / "A)" and a trailing ":" removed) equals
// the section's title, and it comes after section i-1's match. A match becomes
// `heading { level: 2, requiredKey }` with the canonical title. A section not found is added empty
// where it belongs: right before the next matched required heading, or at the end. The result always
// has every required section, in order, each once (the editor's guard assumes it).
//
// Name: when the document starts (first non-empty block, before any matched section) with an H1
// (Word's Title or Heading 1), its text becomes the template name and the block is removed.
// Otherwise the name is the file name without its extension, with _ and - as spaces, first letter
// capitalized, at most 120 characters.

export interface SectionFit {
  matched: { key: string; title: string; /** The text it matched, as written. */ from: string }[];
  added: { key: string; title: string }[];
}

// ── The import report: what came across and what didn't ──────────────────────

export type ImportDrop =
  | { kind: "images"; count: number }
  | { kind: "comments"; count: number }
  | { kind: "footnotes"; count: number }
  | { kind: "headers_footers" }
  /** docx: Word styles we don't map (mammoth's "Unrecognised paragraph style" warnings), by name. */
  | { kind: "styles"; names: string[] }
  /** pdf: text only; tables, columns and images arrive as plain paragraphs or not at all. */
  | { kind: "pdf_layout" }
  /** pdf: lines repeated at the top or bottom of most pages (running headers, page numbers). */
  | { kind: "repeated_lines"; count: number };

export interface ImportReport {
  kind: ImportKind;
  filename: string;
  size: number;
  /** pdf only. */
  pages?: number;
  nameFrom: "title" | "filename";
  placeholders: DetectedPlaceholder[];
  skippedPlaceholders: SkippedPlaceholder[];
  sections: SectionFit;
  counts: { headings: number; paragraphs: number; lists: number; tables: number };
  dropped: ImportDrop[];
}

/**
 * The report as short lines for the Original view (src/domain/import.ts: `describeImport`). Calm,
 * factual, no advice: detected = ["3 variables: First name, Offer end date, Purchase APR",
 * "1 table", "Added Legal notices"], dropped = ["2 images (still shown in Original)"], kept = ["{{#if member}} … {{/if}} shows to customers as written."].
 */
export interface ImportReportLines {
  detected: string[];
  dropped: string[];
  /** Template logic and other `{{…}}` that stays in the text as written, one line per conditional. */
  kept: string[];
}

// ── Conversion (server) ──────────────────────────────────────────────────────

/** What a converter hands the shared finishing step (placeholders, sections, name, report). */
export interface ConvertedFile {
  kind: ImportKind;
  /** Schema JSON before placeholders and sections; block ids not yet assigned. */
  body: JSONContent;
  /** docx: the allowlisted HTML the Original tab shows. */
  compareHtml?: string;
  pages?: number;
  dropped: ImportDrop[];
}

export type ConvertResult = { ok: true; file: ConvertedFile } | { ok: false; code: ImportRefusalCode };

/** The pure finishing step's output (src/domain/import.ts: `finishImport`). Block ids come after (server: ensureBlockIds). */
export interface FinishedImport {
  name: string;
  body: JSONContent;
  variables: Variable[];
  report: ImportReport;
}

export interface FinishImportInput {
  file: ConvertedFile;
  filename: string;
  size: number;
  requiredSections: RequiredSection[];
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
//
// POST /api/imports?team=<team slug>   multipart/form-data { file: File } → ImportResponse
//   A route handler, not a server action: actions cap bodies at 1 MB unless next.config changes.
//   Permission: can(viewer, "template.create", { teamId }) first, before the body is read (403 with
//   the refusal reason); then the body is read with a byte counter, refused (413) past 10 MB + 64 KB.
//   Status: 200 ok · 400 refused (empty/unreadable/too long/no text/locked/pages/content) · 403 · 413 size · 415 type.
//   On success it sets JUST_CREATED_COOKIE (the name is selected on arrival) and JUST_IMPORTED_COOKIE
//   (the rail opens on Original on arrival), and revalidates the Library; the client then
//   router.push(href). Audit: "template.created" with details { name, source: "import:<kind>", filename }.
// GET /api/imports/{uploadId}/file      the original bytes (Content-Type IMPORT_MIME[kind],
//   Content-Disposition inline with filename*=UTF-8''…, Cache-Control private, no-store); 404 when the
//   viewer can't see the template's space.
// GET /api/imports/{uploadId}/view      ImportOriginalView JSON (same permission).

export type ImportResponse =
  | { ok: true; templateId: string; href: string }
  | { ok: false; code: ImportRefusalCode | "permission"; reason: string };

/** One-shot, like `ucomp_created` (src/components/workspace/just-created.ts): holds the template id; max-age 60. */
export const JUST_IMPORTED_COOKIE = "ucomp_imported";

// ── Compare with original: the rail's Original tab ───────────────────────────
//
// Like Preview: picking "Original" widens the rail (docs/decisions/prototype-log.md). The tab exists in the
// rail header whenever the template has an imported source (uploads.template_id), on every version.
// The workspace's document data carries only the cheap ref; the Original view fetches the rest from
// /api/imports/{uploadId}/view the first time it is shown.

export interface ImportOriginalRef {
  uploadId: string;
  filename: string;
  kind: ImportKind;
  size: number;
  uploadedAt: string;
  uploadedByName: string;
}

export type CompareSource =
  /** Allowlisted HTML (p, h1–h3, ul/ol/li, table/tr/th/td, strong/em/u, a, br, img with data: src). */
  | { kind: "docx"; html: string }
  /** The real pages, drawn by the preview's PdfViewer from the file route. */
  | { kind: "pdf"; fileUrl: string; pages: number }
  /** Shown in a <pre> (whitespace kept). */
  | { kind: "txt"; text: string };

export interface ImportOriginalView {
  ref: ImportOriginalRef;
  source: CompareSource;
  report: ImportReport;
  lines: ImportReportLines;
}

// ── Copilot prompt ───────────────────────────────────────────────────────────
//
// No AI in the app: the author copies a prompt into Copilot and pastes the answer back into the
// document. The paste goes through the editor's existing paste path (`{{key}}` → chips; unknown keys
// become optional Text variables). Phase 7a adds to the editor, additively: Markdown plain-text
// paste, and pasted headings that match the document's required sections merge into them instead of
// duplicating them (see the brief).

export interface CopilotPromptInput {
  templateName: string;
  teamName: string;
  /** "Disclosure". */
  contentTypeName: string;
  channels: Channel[];
  /** The content type's sections now. The prompt titles them as the draft's own required headings do (`promptSections`). */
  requiredSections: RequiredSection[];
  variables: Variable[];
  /** The saved draft (the dialog flushes autosave first). Sections with text go in as the current draft. */
  body: JSONContent;
}

export interface CopilotPrompt {
  text: string;
  /** True when the draft had text and the prompt includes it ("Improve this draft"); false = write from scratch. */
  includesDraft: boolean;
}

// ── ⌘K palette ───────────────────────────────────────────────────────────────
//
// Navigation and two creation actions. No persona switch and no demo tools: those stay in the demo
// drawer, never in the product. Groups, in order (empty groups hidden; with a query, Recent is hidden
// and its templates rank in Templates):
//   Recent (no query only, ≤ 5) · Actions · This template (on a template's pages) · Templates ·
//   Pages · Settings · Teams.

export type PaletteGroupKey = "recent" | "actions" | "this_template" | "templates" | "pages" | "settings" | "teams";

export type PaletteActionKey = "new_template" | "import";

export type TemplateTabKey = "content" | "versions" | "usage" | "activity";

/** The sidebar's pages (`NavKey` in src/components/app-shell/nav.ts; kept separate so domain stays UI-free). */
export type PalettePageKey = "library" | "review" | "usage" | "audit";

export type PaletteItem =
  | { kind: "template"; id: string; name: string; teamName: string; status: VersionState; href: string }
  | { kind: "page"; key: PalettePageKey; label: string; href: string }
  | { kind: "template_tab"; key: TemplateTabKey; label: string; href: string }
  | { kind: "settings"; key: string; label: string; group: "team" | "platform"; href: string }
  | { kind: "team"; slug: string; name: string; href: string }
  /** Goes to the space's Library and opens New template (`import` also focuses its Import row). */
  | { kind: "action"; key: PaletteActionKey; label: string; href: string };

export interface PaletteGroup {
  key: PaletteGroupKey;
  heading: string;
  items: PaletteItem[];
}

/**
 * What the palette lists from the server for one space and one search: GET
 * /api/palette/{space}?q=&template=, asked when the palette opens and as the viewer types. Templates
 * are searched on the server (`paletteTemplates` in palette.ts), so no page carries the catalog.
 */
export interface PaletteResults {
  /** Who it was read for. The palette keeps answers per viewer and drops one read for anybody else. */
  viewerId: string;
  space: string;
  /** The search this answers, normalized (`normalizePaletteQuery`); "" at rest. */
  query: string;
  /** The viewer may create a template here. Never in the cross-team space, as in the Library. */
  canCreate: boolean;
  /** The template asked about (`template`, the one whose pages the viewer is on) is one they can see in this space. */
  current: boolean;
  /** At rest: up to five templates the viewer acted on most recently, newest first, without the current one. Empty while searching. */
  recent: PaletteTemplateRow[];
  /** At rest: the first page by name, without those in `recent`. Searching: the matches, best first. */
  templates: PaletteTemplateRow[];
}

export interface PaletteTemplateRow {
  id: string;
  /** As the Library shows it: the open draft's name, otherwise the newest version's. */
  name: string;
  teamSlug: string;
  teamName: string;
  /** State of the template's latest version, as the Library shows it. */
  status: VersionState;
}

/**
 * Library intents: the palette asks, the Library's New template dialog takes it on mount
 * (src/components/library/library-intent.ts, a module-level one-shot shared by client components).
 */
export type LibraryIntent = "new" | "import";
