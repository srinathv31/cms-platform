import { describe, expect, it } from "vitest";
import { IMPORT_DOCUMENTS_ONLY, importUnavailable, type ConvertedFile, type ImportReport } from "./import-types";
import {
  applyPlaceholders,
  classifyPlaceholder,
  countBlocks,
  describeImport,
  keptLines,
  refusalForUnreadableKind,
  finishImport,
  fitRequiredSections,
  joinLine,
  nameFromFilename,
  pdfLinesToBody,
  sanitizeFilename,
  scanPlaceholders,
  takeTitle,
  textToBody,
  type PdfPageText,
  type PdfTextItem,
} from "./import";
import type { JSONContent, RequiredSection } from "./types";

const SECTIONS: RequiredSection[] = [
  { key: "offer_details", title: "Offer details" },
  { key: "rates_and_fees", title: "Rates and fees" },
  { key: "legal_notices", title: "Legal notices" },
];

const BOLD = [{ type: "bold" }];
const t = (text: string, marks?: JSONContent["marks"]): JSONContent => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (...content: (string | JSONContent)[]): JSONContent => ({
  type: "paragraph",
  content: content.map((c) => (typeof c === "string" ? t(c) : c)),
});
const h = (level: number, text: string, attrs: Record<string, unknown> = {}): JSONContent => ({
  type: "heading",
  attrs: { level, ...attrs },
  content: [t(text)],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const chip = (key: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "variable", attrs: { key }, marks } : { type: "variable", attrs: { key } };
const required = (key: string, title: string, id?: string): JSONContent => ({
  type: "heading",
  attrs: { ...(id ? { id } : {}), level: 2, requiredKey: key },
  content: [t(title)],
});

// ── Placeholders ─────────────────────────────────────────────────────────────

describe("classifyPlaceholder: the contract's rules, in order", () => {
  it.each([
    ["first_name", "first_name"],
    [" first_name ", "first_name"],
    ["First Name", "first_name"],
    ["OfferEndDate", "offer_end_date"],
    ["Purchase APR", "purchase_apr"],
    ["offer-end.date", "offer_end_date"],
    ["Annual_Fee", "annual_fee"],
  ])("{{%s}} is the key %s", (inner, key) => {
    expect(classifyPlaceholder(inner)).toEqual({ kind: "key", key });
  });

  it.each(["#if member", "/if", "^empty", "> partial", "!comment", "&raw", "else", "else if x", "name | upper", "fn(x)", "a = b"])(
    "{{%s}} is template logic",
    (inner) => {
      expect(classifyPlaceholder(inner)).toEqual({ kind: "logic" });
    },
  );

  it.each(["", "  ", "9lives", "$amount", "first name!", "x".repeat(65), "Ünïcode name"])("{{%s}} is invalid", (inner) => {
    expect(classifyPlaceholder(inner)).toEqual({ kind: "invalid" });
  });

  it("a name of exactly 64 characters is still a name", () => {
    expect(classifyPlaceholder("A".repeat(64)).kind).toBe("key");
  });
});

describe("scanPlaceholders", () => {
  it("finds tokens with no braces inside, and their offsets", () => {
    const tokens = scanPlaceholders("Hi {{First Name}}, {{#if member}}yes{{/if}} {{ {{x}}");
    expect(tokens.map((tk) => [tk.raw, tk.index, tk.class.kind])).toEqual([
      ["{{First Name}}", 3, "key"],
      ["{{#if member}}", 19, "logic"],
      ["{{/if}}", 36, "logic"],
      ["{{x}}", 47, "key"],
    ]);
  });

  it("an inline atom ends a token", () => {
    expect(scanPlaceholders("{{first\uFFFCname}}")).toEqual([]);
  });
});

describe("applyPlaceholders", () => {
  it("turns key placeholders into chips, keeping the text around them", () => {
    const { body, placeholders, skipped } = applyPlaceholders(doc(p("Dear {{First Name}}, your APR is {{purchase_apr}}.")));
    expect(body).toEqual(doc(p("Dear ", chip("first_name"), ", your APR is ", chip("purchase_apr"), ".")));
    expect(placeholders).toEqual([
      { key: "first_name", label: "First name", raw: ["{{First Name}}"], count: 1 },
      { key: "purchase_apr", label: "Purchase APR", raw: ["{{purchase_apr}}"], count: 1 },
    ]);
    expect(skipped).toEqual([]);
  });

  it("dedupes by key in order of first use and lists every spelling", () => {
    const { placeholders } = applyPlaceholders(
      doc(p("{{first_name}} {{Offer End Date}}"), p("{{First Name}} and {{first_name}} again")),
    );
    expect(placeholders).toEqual([
      { key: "first_name", label: "First name", raw: ["{{first_name}}", "{{First Name}}"], count: 3 },
      { key: "offer_end_date", label: "Offer end date", raw: ["{{Offer End Date}}"], count: 1 },
    ]);
  });

  it("a placeholder split across formatted runs is one chip with the marks of the run it starts in", () => {
    const { body } = applyPlaceholders(doc(p(t("APR: {{Purch", BOLD), t("ase APR}} now"))));
    expect(body).toEqual(doc(p(t("APR: ", BOLD), chip("purchase_apr", BOLD), t(" now"))));
  });

  it("a token spanning three runs leaves no stray text behind", () => {
    const { body } = applyPlaceholders(doc(p(t("a {{fir"), t("st_na", BOLD), t("me}} b"))));
    expect(body).toEqual(doc(p(t("a "), chip("first_name"), t(" b"))));
  });

  it("keeps template logic and invalid tokens as text, and reports them with counts", () => {
    const input = doc(p("{{#if member}}Members{{/if}} {{9x}} {{#if member}}"));
    const { body, placeholders, skipped } = applyPlaceholders(input);
    expect(body).toEqual(input);
    expect(placeholders).toEqual([]);
    expect(skipped).toEqual([
      { raw: "{{#if member}}", reason: "logic", count: 2 },
      { raw: "{{/if}}", reason: "logic", count: 1 },
      { raw: "{{9x}}", reason: "invalid", count: 1 },
    ]);
  });

  it("reaches headings, list items and table cells, and leaves existing chips alone", () => {
    const table: JSONContent = {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p("{{annual_fee}}")] }] }],
    };
    const list: JSONContent = { type: "bulletList", content: [{ type: "listItem", content: [p("{{Promo Code}}")] }] };
    const { body, placeholders } = applyPlaceholders(doc(h(3, "For {{First Name}}"), list, table, p(chip("x"), " {{y}}")));
    expect(placeholders.map((x) => x.key)).toEqual(["first_name", "promo_code", "annual_fee", "y"]);
    expect(body.content?.[3]).toEqual(p(chip("x"), t(" "), chip("y")));
  });

  it("returns the same document when there is nothing to change", () => {
    const input = doc(p("No placeholders here"));
    expect(applyPlaceholders(input).body).toBe(input);
  });
});

// ── Required sections ────────────────────────────────────────────────────────

describe("fitRequiredSections", () => {
  it("matches headings of any level by normalized text, in order, as the required H2 with the canonical title", () => {
    const input = doc(
      p("Intro"),
      { ...h(1, "1. OFFER  DETAILS:"), attrs: { level: 1, id: "b1" } },
      p("Offer body"),
      h(3, "Rates and Fees"),
      p("Rates body"),
      h(2, "Legal Notices"),
    );
    const { body, fit } = fitRequiredSections(input, SECTIONS);
    expect(body.content).toEqual([
      p("Intro"),
      required("offer_details", "Offer details", "b1"),
      p("Offer body"),
      required("rates_and_fees", "Rates and fees"),
      p("Rates body"),
      required("legal_notices", "Legal notices"),
    ]);
    expect(fit.matched).toEqual([
      { key: "offer_details", title: "Offer details", from: "1. OFFER DETAILS:" },
      { key: "rates_and_fees", title: "Rates and fees", from: "Rates and Fees" },
      { key: "legal_notices", title: "Legal notices", from: "Legal Notices" },
    ]);
    expect(fit.added).toEqual([]);
  });

  it("an all-bold paragraph counts; a partly bold one doesn't", () => {
    const { fit } = fitRequiredSections(
      doc(p(t("Offer details", BOLD)), p(t("Rates", BOLD), t(" and fees")), p(t("Rates and fees:", BOLD))),
      SECTIONS,
    );
    expect(fit.matched.map((m) => m.from)).toEqual(["Offer details", "Rates and fees:"]);
  });

  it("adds a missing section right before the next matched one", () => {
    const { body, fit } = fitRequiredSections(doc(p("Intro"), h(2, "Rates and fees"), p("Rates")), SECTIONS);
    expect(body.content).toEqual([
      p("Intro"),
      required("offer_details", "Offer details"),
      required("rates_and_fees", "Rates and fees"),
      p("Rates"),
      required("legal_notices", "Legal notices"),
    ]);
    expect(fit.added).toEqual([
      { key: "offer_details", title: "Offer details" },
      { key: "legal_notices", title: "Legal notices" },
    ]);
  });

  it("adds every section at the end, in order, when none is found", () => {
    const { body } = fitRequiredSections(doc(p("Just text")), SECTIONS);
    expect(body.content).toEqual([
      p("Just text"),
      required("offer_details", "Offer details"),
      required("rates_and_fees", "Rates and fees"),
      required("legal_notices", "Legal notices"),
    ]);
  });

  it("matches each section once and only after the previous match; out-of-order and repeat headings stay ordinary", () => {
    const { body, fit } = fitRequiredSections(
      doc(h(2, "Rates and fees"), h(2, "Offer details"), h(2, "Rates and fees"), h(2, "Legal notices")),
      SECTIONS,
    );
    expect(body.content).toEqual([
      required("offer_details", "Offer details"),
      required("rates_and_fees", "Rates and fees"),
      { ...h(2, "Offer details"), attrs: { level: 2 } },
      h(2, "Rates and fees"),
      required("legal_notices", "Legal notices"),
    ]);
    expect(fit.added.map((a) => a.key)).toEqual(["offer_details"]);
  });

  it("a stray requiredKey on an unmatched heading is cleared, so each section appears once", () => {
    const { body } = fitRequiredSections(doc(h(2, "Something", { requiredKey: "offer_details" })), SECTIONS);
    expect(body.content?.[0]).toEqual(h(2, "Something", { requiredKey: null }));
    expect(body.content?.filter((b) => b.attrs?.requiredKey).map((b) => b.attrs?.requiredKey)).toEqual([
      "offer_details",
      "rates_and_fees",
      "legal_notices",
    ]);
  });

  it("paragraphs with ordinary text are never sections", () => {
    const { fit } = fitRequiredSections(doc(p("Offer details")), SECTIONS);
    expect(fit.matched).toEqual([]);
  });
});

// ── Name ─────────────────────────────────────────────────────────────────────

describe("takeTitle", () => {
  it("takes a leading H1 as the name and removes it", () => {
    const { body, title } = takeTitle(doc(p(""), h(1, "  Spring   balance transfer "), p("Body")));
    expect(title).toBe("Spring balance transfer");
    expect(body).toEqual(doc(p("Body")));
  });

  it("leaves the document alone when the first non-empty block isn't an H1", () => {
    const input = doc(p("Body"), h(1, "Late title"));
    expect(takeTitle(input)).toEqual({ body: input, title: null });
    expect(takeTitle(doc(h(2, "Not a title"))).title).toBeNull();
  });

  it("an H1 that is a required section is not a title", () => {
    expect(takeTitle(doc(h(1, "Offer details")), SECTIONS).title).toBeNull();
  });

  it("clamps the name to 120 characters", () => {
    expect(takeTitle(doc(h(1, "x".repeat(200)))).title).toHaveLength(120);
  });
});

describe("nameFromFilename", () => {
  it.each([
    ["spring_offer-2027.docx", "Spring offer 2027"],
    ["rate change notice.pdf", "Rate change notice"],
    ["Notes.final.txt", "Notes.final"],
    ["C:\\docs\\fees.txt", "Fees"],
    ["___.txt", "Untitled template"],
    [".txt", ".txt"],
  ])("%s → %s", (file, name) => {
    expect(nameFromFilename(file)).toBe(name);
  });

  it("is at most 120 characters", () => {
    expect(nameFromFilename(`${"a".repeat(300)}.docx`)).toHaveLength(120);
  });
});

describe("sanitizeFilename", () => {
  it("drops folders and control characters, collapses spaces, keeps the extension when shortening", () => {
    expect(sanitizeFilename("../../etc/pass\u0000wd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("  Spring   offer.docx ")).toBe("Spring offer.docx");
    const long = sanitizeFilename(`${"b".repeat(200)}.docx`);
    expect(long).toHaveLength(120);
    expect(long.endsWith(".docx")).toBe(true);
    expect(sanitizeFilename("/")).toBe("file");
  });
});

// ── Text ─────────────────────────────────────────────────────────────────────

describe("textToBody", () => {
  it("a blank line separates paragraphs; lines inside one are joined", () => {
    expect(textToBody("\uFEFFFirst line\r\nstill first\r\n\r\n\r\nSecond")).toEqual(doc(p("First line still first"), p("Second")));
  });

  it("with no blank line anywhere, each line is a paragraph", () => {
    expect(textToBody("One\nTwo\n  \nThree".replace("\n  \n", "\n"))).toEqual(doc(p("One"), p("Two"), p("Three")));
  });

  it("joins a line ending inside {{ with no space", () => {
    expect(textToBody("Dear {{First\nName}},\n\nNext")).toEqual(doc(p("Dear {{FirstName}},"), p("Next")));
  });

  it("an empty or whitespace file has no blocks", () => {
    expect(textToBody(" \n\n \n")).toEqual(doc());
  });
});

describe("joinLine", () => {
  it("adds a space, or none inside a placeholder", () => {
    expect(joinLine("", "a")).toBe("a");
    expect(joinLine("a", "b")).toBe("a b");
    expect(joinLine("rate {{purchase_", "apr}} today")).toBe("rate {{purchase_apr}} today");
    expect(joinLine("{{a}} b", "c")).toBe("{{a}} b c");
  });
});

// ── PDF lines ────────────────────────────────────────────────────────────────

/** A line of text as one pdf.js item (width ≈ 0.5 em per character). */
const item = (str: string, y: number, h = 10, x = 72): PdfTextItem => ({ str, x, y, w: str.length * h * 0.5, h });
const page = (...items: PdfTextItem[]): PdfPageText => ({ items });

describe("pdfLinesToBody", () => {
  it("groups items into lines by y and orders them by x, with a space where there is a gap", () => {
    const { body } = pdfLinesToBody([page(item("world", 100, 10, 110), item("Hello", 100.5, 10, 72), item("!", 100, 10, 135))]);
    expect(body).toEqual(doc(p("Hello world!")));
  });

  it("starts a paragraph on a gap over 1.5× the line height and joins the lines in between", () => {
    const { body } = pdfLinesToBody([page(item("one a", 100), item("one b", 112), item("two a", 130), item("two b", 142))]);
    expect(body).toEqual(doc(p("one a one b"), p("two a two b")));
  });

  it("joins a line ending inside {{ with no space", () => {
    const { body } = pdfLinesToBody([page(item("Your APR is {{Purchase", 100), item("APR}} today.", 112))]);
    expect(body).toEqual(doc(p("Your APR is {{PurchaseAPR}} today.")));
  });

  it("turns •, - and 1. lines into lists, with wrapped item lines joined", () => {
    const { body } = pdfLinesToBody([
      page(
        item("Intro", 100),
        item("• First", 130),
        item("continues", 142),
        item("- Second", 154),
        item("1. Step one", 190),
        item("2) Step two", 202),
      ),
    ]);
    expect(body).toEqual(
      doc(
        p("Intro"),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p("First continues")] },
            { type: "listItem", content: [p("Second")] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [p("Step one")] },
            { type: "listItem", content: [p("Step two")] },
          ],
        },
      ),
    );
  });

  it("drops lines repeated at the top or bottom of most pages, numbers ignored", () => {
    const bodies = ["Alpha", "Beta", "Gamma"];
    const pages = [1, 2, 3].map((n) =>
      page(
        item("Coral Bank", 30),
        item(`${bodies[n - 1]} one`, 100),
        item(`${bodies[n - 1]} two`, 130),
        item("Coral Bank · Spring offer", 760),
        item(`Page ${n} of 3`, 775),
      ),
    );
    const { body, repeatedLines } = pdfLinesToBody(pages);
    expect(repeatedLines).toBe(3);
    expect(body).toEqual(doc(p("Alpha one"), p("Alpha two"), p("Beta one"), p("Beta two"), p("Gamma one"), p("Gamma two")));
  });

  it("keeps an edge line that appears on only half the pages, and repeats nothing on one page", () => {
    const pages = [page(item("Draft", 30), item("A", 100)), page(item("B", 100), item("C", 112))];
    expect(pdfLinesToBody(pages).repeatedLines).toBe(0);
    expect(pdfLinesToBody([page(item("Only", 30))]).repeatedLines).toBe(0);
  });

  it("lines set clearly larger than the body text become headings (H1 from 1.6×)", () => {
    const { body } = pdfLinesToBody([
      page(
        item("Rate change notice", 60, 20),
        item("Offer details", 100, 13),
        item("The body text is set in the smaller size", 130),
        item("and runs for most of the page.", 142),
      ),
    ]);
    expect(body).toEqual(
      doc(h(1, "Rate change notice"), h(2, "Offer details"), p("The body text is set in the smaller size and runs for most of the page.")),
    );
  });

  it("carries a paragraph over a page break when the sentence goes on", () => {
    const { body } = pdfLinesToBody([page(item("The rate applies to", 700)), page(item("balance transfers.", 72), item("New one.", 100))]);
    expect(body).toEqual(doc(p("The rate applies to balance transfers."), p("New one.")));
  });

  it("an empty PDF has no blocks", () => {
    expect(pdfLinesToBody([page(), page(item("  ", 10))]).body).toEqual(doc());
  });
});

// ── Finishing and the report ─────────────────────────────────────────────────

const converted = (body: JSONContent, extra: Partial<ConvertedFile> = {}): ConvertedFile => ({
  kind: "docx",
  body,
  dropped: [],
  ...extra,
});

describe("finishImport", () => {
  it("names from the title, makes chips and Text variables, fits sections, and reports it all", () => {
    const table: JSONContent = {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("Fee")] }] }],
    };
    const done = finishImport({
      file: converted(doc(h(1, "Spring offer"), p("Dear {{First Name}}, {{#if member}}"), h(2, "Offer details"), table), {
        dropped: [{ kind: "images", count: 1 }],
      }),
      filename: "../spring.docx",
      size: 1234,
      requiredSections: SECTIONS,
    });
    expect(done.name).toBe("Spring offer");
    expect(done.variables).toEqual([{ key: "first_name", label: "First name", type: "text", required: true, sample: "" }]);
    expect(done.body.content?.map((b) => b.attrs?.requiredKey ?? b.type)).toEqual([
      "paragraph",
      "offer_details",
      "table",
      "rates_and_fees",
      "legal_notices",
    ]);
    expect(done.report).toEqual<ImportReport>({
      kind: "docx",
      filename: "spring.docx",
      size: 1234,
      nameFrom: "title",
      placeholders: [{ key: "first_name", label: "First name", raw: ["{{First Name}}"], count: 1 }],
      skippedPlaceholders: [{ raw: "{{#if member}}", reason: "logic", count: 1 }],
      sections: {
        matched: [{ key: "offer_details", title: "Offer details", from: "Offer details" }],
        added: [
          { key: "rates_and_fees", title: "Rates and fees" },
          { key: "legal_notices", title: "Legal notices" },
        ],
      },
      counts: { headings: 0, paragraphs: 1, lists: 0, tables: 1 },
      dropped: [{ kind: "images", count: 1 }],
    });
  });

  it("falls back to the file name, and carries a PDF's page count", () => {
    const done = finishImport({
      file: converted(doc(p("Text")), { kind: "pdf", pages: 2, dropped: [{ kind: "pdf_layout" }] }),
      filename: "rate_change-notice.pdf",
      size: 10,
      requiredSections: SECTIONS,
    });
    expect(done.name).toBe("Rate change notice");
    expect(done.report.nameFrom).toBe("filename");
    expect(done.report.pages).toBe(2);
    expect(done.variables).toEqual([]);
  });

  it("the H1 title isn't scanned for placeholders (it is the name, not the body)", () => {
    const done = finishImport({ file: converted(doc(h(1, "For {{First Name}}"))), filename: "a.docx", size: 1, requiredSections: SECTIONS });
    expect(done.name).toBe("For {{First Name}}");
    expect(done.variables).toEqual([]);
  });
});

describe("countBlocks", () => {
  it("counts top-level headings (not required ones), non-empty paragraphs, lists and tables", () => {
    expect(
      countBlocks(
        doc(h(1, "A"), required("offer_details", "Offer details"), p(""), p("x"), { type: "bulletList" }, { type: "orderedList" }, { type: "table" }),
      ),
    ).toEqual({ headings: 1, paragraphs: 1, lists: 2, tables: 1 });
  });
});

describe("describeImport", () => {
  const base: ImportReport = {
    kind: "docx",
    filename: "Spring offer.docx",
    size: 1,
    nameFrom: "title",
    placeholders: [],
    skippedPlaceholders: [],
    sections: { matched: [], added: [] },
    counts: { headings: 0, paragraphs: 0, lists: 0, tables: 0 },
    dropped: [],
  };

  it("says what came across, in short lines", () => {
    const lines = describeImport({
      ...base,
      kind: "pdf",
      pages: 2,
      placeholders: [
        { key: "first_name", label: "First name", raw: ["{{First Name}}"], count: 2 },
        { key: "offer_end_date", label: "Offer end date", raw: ["{{offer_end_date}}"], count: 1 },
        { key: "purchase_apr", label: "Purchase APR", raw: ["{{Purchase APR}}"], count: 1 },
      ],
      counts: { headings: 2, paragraphs: 5, lists: 1, tables: 1 },
      sections: { matched: [], added: [{ key: "legal_notices", title: "Legal notices" }] },
    });
    expect(lines.detected).toEqual([
      "3 variables, all Text and required: First name, Offer end date, Purchase APR",
      "2 pages",
      "2 headings",
      "1 list",
      "1 table",
      "Added empty section: Legal notices",
    ]);
    expect(lines.dropped).toEqual([]);
  });

  it("singulars, and several added sections", () => {
    const lines = describeImport({
      ...base,
      placeholders: [{ key: "a", label: "A", raw: ["{{a}}"], count: 1 }],
      counts: { headings: 1, paragraphs: 0, lists: 2, tables: 3 },
      sections: {
        matched: [],
        added: [
          { key: "offer_details", title: "Offer details" },
          { key: "rates_and_fees", title: "Rates and fees" },
          { key: "legal_notices", title: "Legal notices" },
        ],
      },
    });
    expect(lines.detected).toEqual([
      "1 variable, Text and required: A",
      "1 heading",
      "2 lists",
      "3 tables",
      "Added empty sections: Offer details, Rates and fees and Legal notices",
    ]);
  });

  it("says what didn't come across", () => {
    const lines = describeImport({
      ...base,
      dropped: [
        { kind: "images", count: 2 },
        { kind: "comments", count: 1 },
        { kind: "footnotes", count: 3 },
        { kind: "headers_footers" },
        { kind: "styles", names: ["Quote"] },
        { kind: "styles", names: ["Quote", "Intense Quote"] },
        { kind: "pdf_layout" },
        { kind: "repeated_lines", count: 1 },
        { kind: "repeated_lines", count: 2 },
      ],
    });
    expect(lines.dropped).toEqual([
      "2 images (still shown in Original)",
      "1 comment",
      "3 footnotes",
      "Headers and footers",
      "Quote formatting",
      "Quote and Intense Quote formatting",
      "Layout and images (PDF text only)",
      "1 repeated header or footer line",
      "2 repeated header or footer lines",
    ]);
  });

  it("says where the text sits when no section was found", () => {
    const text = describeImport({ ...base, kind: "txt", counts: { headings: 0, paragraphs: 3, lists: 0, tables: 0 } });
    expect(text.detected).toContain("The text stays above the first section");
    const withHeading = describeImport({ ...base, counts: { headings: 1, paragraphs: 3, lists: 0, tables: 0 } });
    expect(withHeading.detected).not.toContain("The text stays above the first section");
    expect(describeImport(base).detected).toEqual([]);
  });
});

describe("keptLines: template logic stays as text, one line per conditional", () => {
  const skip = (raw: string, count = 1, reason: "logic" | "invalid" = "logic") => ({ raw, reason, count });
  const base0 = (): ImportReport => ({
    kind: "docx",
    filename: "a.docx",
    size: 1,
    nameFrom: "title",
    placeholders: [],
    skippedPlaceholders: [],
    sections: { matched: [], added: [] },
    counts: { headings: 0, paragraphs: 0, lists: 0, tables: 0 },
    dropped: [],
  });

  it("pairs an opener with its closer", () => {
    expect(keptLines([skip("{{#if member}}"), skip("{{/if}}")])).toEqual(["{{#if member}} … {{/if}} shows to customers as written."]);
  });

  it("two conditionals sharing one closer spelling are two lines", () => {
    expect(keptLines([skip("{{#if a}}"), skip("{{/if}}", 2), skip("{{#if b}}")])).toEqual([
      "{{#if a}} … {{/if}} shows to customers as written.",
      "{{#if b}} … {{/if}} shows to customers as written.",
    ]);
  });

  it("an else belongs to the conditional it sits in", () => {
    expect(keptLines([skip("{{#if member}}"), skip("{{else}}"), skip("{{/if}}")])).toEqual([
      "{{#if member}} … {{else}} … {{/if}} shows to customers as written.",
    ]);
  });

  it("an unclosed opener, a filter and braces that aren't a name are lines of their own", () => {
    expect(keptLines([skip("{{#if member}}"), skip("{{x | upper}}"), skip("{{9x}}", 2, "invalid")])).toEqual([
      "{{#if member}} shows to customers as written.",
      "{{x | upper}} shows to customers as written.",
      "{{9x}} shows to customers as written.",
    ]);
    expect(keptLines([])).toEqual([]);
  });

  it("describeImport carries them", () => {
    expect(describeImport({ ...base0(), skippedPlaceholders: [skip("{{#if member}}"), skip("{{/if}}")] }).kept).toEqual([
      "{{#if member}} … {{/if}} shows to customers as written.",
    ]);
  });
});

describe("refusalForUnreadableKind", () => {
  it("by what the name claims", () => {
    expect(refusalForUnreadableKind("old.DOC")).toBe("legacyDoc");
    expect(refusalForUnreadableKind("fake.pdf")).toBe("notPdf");
    expect(refusalForUnreadableKind("fake.docx")).toBe("notWord");
    expect(refusalForUnreadableKind("picture.png")).toBe("type");
    expect(refusalForUnreadableKind("binary.txt")).toBe("type");
  });
});

// Import makes documents: a file's text becomes a body, and an alert has none (decision 0034).
describe("importUnavailable", () => {
  it("offers Import for a document, and says why not for an alert", () => {
    expect(importUnavailable("document")).toBeNull();
    expect(importUnavailable("message")).toBe(IMPORT_DOCUMENTS_ONLY);
    expect(IMPORT_DOCUMENTS_ONLY).toBe("Only documents can be imported.");
  });
});
