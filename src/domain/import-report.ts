// What an import found in a file, as facts: the kind of file, the placeholders it turned into variables, the
// required sections it matched or added, what it counted and what it dropped. Stored beside the original when a
// template is imported (`TemplateService.createImported`) and read back with it. The sentences people read
// ("3 variables: First name, …", `describeImport` in ./import.ts) and the Original tab's view are the BFF's:
// `import-types.ts` holds the contract they are built on, and re-exports these.
//
// Pure types. The service interfaces import this file, not `import-types.ts`, which also holds the worded view
// models (decision 0072).

export type ImportKind = "docx" | "pdf" | "txt";

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

export interface SectionFit {
  matched: {
    key: string;
    title: string;
    /** The text it matched, as written. */ from: string;
  }[];
  added: { key: string; title: string }[];
}

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
  counts: {
    headings: number;
    paragraphs: number;
    lists: number;
    tables: number;
  };
  dropped: ImportDrop[];
}
