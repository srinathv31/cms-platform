// The hand-built golden cases: each pins one group of rules from docs/render-spec.md. They are code
// because TipTap JSON is long to write by hand; `npm run golden:update` writes each one's
// `cases/<slug>/input.json` from here, and golden.test.ts fails when a file is out of step.
//
// The cases that come from the seed (realistic disclosures) are NOT here: `npm run golden:import`
// freezes those into their input.json once, so editing the seed never moves a golden file.
//
// A slug that starts with `error-` must fail before any channel (values or document check); one that
// starts with `pdf-error-` must render every channel except the PDF (parity.test.ts asserts both).

import type { Variable } from "@/editor/model/types";
import type { RenderFixture } from "@/server/render/testing/fixture";
import {
  b,
  br,
  callout,
  cell,
  doc,
  h,
  head,
  item,
  italic,
  li,
  line,
  link,
  nestedOrdered,
  ol,
  p,
  para,
  row,
  rule,
  section,
  span,
  t,
  table,
  td,
  th,
  ul,
  underline,
  v,
  variable,
  bold,
  linkMark,
  type Node,
} from "@/server/render/testing/tiptap";

/** The render time every case uses (the spec's example). */
export const GOLDEN_AT = "2027-03-04T12:00:00.000Z";

export interface FocusedCase {
  slug: string;
  input: RenderFixture;
}

/** A JSON number written exactly as given (Node 24): 21.90 stays 21.90 in input.json. */
const num = (text: string) => (JSON as unknown as { rawJSON(text: string): object }).rawJSON(text);

function make(
  slug: string,
  templateName: string,
  parts: {
    body: Node;
    variables?: Variable[];
    values?: Record<string, unknown>;
    emailSubject?: Node | null;
    emailPreheader?: Node | null;
    versionNumber?: number | null;
  },
): FocusedCase {
  return {
    slug,
    input: {
      templateId: "UC-GOLDEN",
      templateName,
      versionNumber: parts.versionNumber === undefined ? 1 : parts.versionNumber,
      at: GOLDEN_AT,
      variables: parts.variables ?? [],
      values: parts.values ?? {},
      body: parts.body,
      emailSubject: parts.emailSubject ?? null,
      emailPreheader: parts.emailPreheader ?? null,
    },
  };
}

const first = variable("first_name", "First name", "text", true, "Maya");

// ── Lists ────────────────────────────────────────────────────────────────────

const listsDefault = make("lists-default-numbering", "Default numbering by depth", {
  body: doc(
    h(1, t("Default numbering")),
    para("Ordered inside ordered inside ordered inside ordered: 1. a. i. then 1. again."),
    ol({}, item("Level one, first", ol({}, item("Level two", ol({}, item("Level three", ol({}, item("Level four, back to decimal")))))) ), item("Level one, second")),
    para("Bullets inside bullets: disc, circle, square, then disc again."),
    ul(item("Bullet one", ul(item("Bullet two", ul(item("Bullet three", ul(item("Bullet four"))))))), item("Bullet one, again")),
    para("Only ordered ancestors count for an ordered list: ordered, bullet, ordered gives 1. then a."),
    ol({}, item("Ordered", ul(item("Bullet in ordered", ol({}, item("Ordered in bullet in ordered")))))),
    para("Only bullet ancestors count for a bullet: bullet, ordered, bullet, bullet gives disc, 1., circle, square."),
    ul(item("Bullet", ol({}, item("Ordered in bullet", ul(item("Bullet at depth one", ul(item("Bullet at depth two")))))))),
    para("A styled parent does not change the child: (a) then a."),
    ol({ format: "lower-alpha", delimiter: "parens" }, item("Styled parent", ol({}, item("Unstyled child")))),
    para("Nine levels deep (the limit):"),
    nestedOrdered(9, "Level nine"),
  ),
});

const listStyle = (format: Parameters<typeof ol>[0]["format"], delimiter: Parameters<typeof ol>[0]["delimiter"], label: string): Node[] => [
  para(`Style ${label}`),
  ol({ format, delimiter }, item("First"), item("Second"), item("Third"), item("Fourth")),
];

const listsStyles = make("lists-author-styles", "Numbering styles the author can choose", {
  body: doc(
    h(1, t("Numbering styles")),
    ...listStyle("decimal", "period", "1."),
    ...listStyle("lower-alpha", "period", "a."),
    ...listStyle("upper-alpha", "period", "A."),
    ...listStyle("lower-roman", "period", "i."),
    ...listStyle("upper-roman", "period", "I."),
    ...listStyle("decimal", "parens", "(1)"),
    ...listStyle("lower-alpha", "parens", "(a)"),
    ...listStyle("lower-roman", "parens", "(i)"),
    ...listStyle("decimal", "paren-right", "1)"),
    ...listStyle("lower-alpha", "paren-right", "a)"),
    para("A stored pair the menu does not offer, upper-alpha with parentheses:"),
    ol({ format: "upper-alpha", delimiter: "parens" }, item("First"), item("Second")),
    para("Only the format chosen (delimiter null): the delimiter defaults to a period."),
    ol({ format: "upper-roman", delimiter: null }, item("First"), item("Second")),
    para("Only the delimiter chosen (format null): the format defaults by depth."),
    ol({ format: null, delimiter: "paren-right" }, item("First"), item("Second")),
  ),
});

const listsStart = make("lists-start-numbers", "Start numbers", {
  body: doc(
    h(1, t("Start numbers")),
    para("Start 0, decimal:"),
    ol({ start: 0 }, item("Zero"), item("One")),
    para("Start 5, a): e) f) g)"),
    ol({ start: 5, format: "lower-alpha", delimiter: "paren-right" }, item("Fifth"), item("Sixth"), item("Seventh")),
    para("Start 25, (a): (y) (z) (aa) (ab)"),
    ol({ start: 25, format: "lower-alpha", delimiter: "parens" }, item("y"), item("z"), item("aa"), item("ab")),
    para("Start 702, a.: zz. aaa."),
    ol({ start: 702, format: "lower-alpha" }, item("zz"), item("aaa")),
    para("Start 3998, I.: roman ends at 3999, then digits."),
    ol({ start: 3998, format: "upper-roman" }, item("MMMCMXCVIII"), item("MMMCMXCIX"), item("Digits"), item("Digits again")),
    para("Start 1994, i.:"),
    ol({ start: 1994, format: "lower-roman" }, item("Year"), item("Next year")),
    para("Start 0 in letters and roman falls back to digits, keeping the delimiter:"),
    ol({ start: 0, format: "lower-alpha" }, item("Zero in letters"), item("One in letters")),
    ol({ start: 0, format: "lower-roman", delimiter: "parens" }, item("Zero in roman"), item("One in roman")),
    para("Start 9999, 1): 10000) follows."),
    ol({ start: 9999, format: "decimal", delimiter: "paren-right" }, item("Largest start"), item("Past it"), item("And on")),
  ),
});

const listsMixed = make("lists-mixed", "Lists with other blocks", {
  variables: [first],
  values: { first_name: "Maya" },
  body: doc(
    h(1, t("Lists with other blocks")),
    ol(
      {},
      item("Item with a second paragraph", para("The second paragraph of the first item.")),
      li(p(t("Item with a hard break"), br, t("continued on a new line"))),
      li(p()),
      item("Item after an empty item"),
      li(p(t("Item for "), v("first_name"), t(", with a "), link("link", "https://coral.example/terms"), t(" and "), b("bold"), t("."))),
    ),
    ul(
      item("Bullet, then numbers below it", ol({ format: "upper-alpha" }, item("Alpha one", ul(item("Bullet in A."))), item("Alpha two"))),
      item("Bullet two"),
    ),
    ol({}, item("A list straight after another list")),
    table(row(head("Where"), head("Steps")), row(cell("In a cell"), td(ol({}, item("Step one", ol({}, item("Sub-step"))), item("Step two"))))),
    ul(li(p(t("Bullet in a cell's sibling list")))),
  ),
});

// ── Optional variables, blank lines, spaces ──────────────────────────────────

const optionalVariables = make("optional-variables", "Optional variable lines", {
  variables: [
    first,
    variable("apr", "APR", "percent", true, "21.99"),
    variable("promo_note", "Promo note", "text", false, ""),
    variable("fee_note", "Fee note", "currency", false, ""),
    variable("zero_width_note", "Invisible note", "text", false, ""),
    variable("cashback_note", "Cash back note", "text", false, "Earn 2% back."),
  ],
  values: { first_name: "Maya", apr: "21.99", zero_width_note: "\u200b\u200b", cashback_note: "Earn 2% back." },
  body: doc(
    h(1, t("Offer for "), v("first_name")),
    para("Before the empty optional lines."),
    p(v("promo_note")),
    p(t("  "), v("promo_note"), t("  "), br),
    p(v("zero_width_note")),
    para("The next line keeps its text and loses only the empty value:"),
    p(t("Fee: "), v("fee_note")),
    p(v("cashback_note")),
    section(2, "rates_and_fees", v("promo_note")),
    h(2, t("Rates")),
    ol(
      {},
      item("First item stays number 1."),
      li(p(v("promo_note"))),
      item("Third item becomes number 2.", ol({}, li(p(v("promo_note"))), item("Nested item becomes a."), item("Nested item becomes b."))),
      li(p(v("fee_note")), ol({}, item("Nested item of a removed first line keeps its list."))),
      item("Last item becomes number 4."),
    ),
    ol({ start: 7 }, li(p(v("promo_note"))), item("Starts at seven after the removal."), li(p(v("fee_note")))),
    ul(li(p(v("promo_note"))), item("Bullet two stays."), li(p(v("fee_note")))),
    para("A list whose items are all removed disappears:"),
    ol({}, li(p(v("promo_note"))), li(p(v("fee_note")))),
    callout(p(v("promo_note"))),
    callout(p(v("promo_note")), para("A callout keeps its other paragraph.")),
    table(row(head("Name"), head("Optional")), row(cell("First row"), td(p(v("promo_note")))), row(cell("Second row"), cell("Present"))),
    para("After the optional lines."),
  ),
});

const blankLines = make("blank-lines", "Blank lines everywhere", {
  body: doc(
    p(),
    para("First paragraph, after a blank paragraph at the very start."),
    p(),
    p(),
    para("After two blank paragraphs."),
    p(t("   ")),
    p(br),
    p(t("\u00a0")),
    para("After a paragraph of spaces, one of a hard break and one of a no-break space."),
    ul(li(p(t("Bullet with a blank paragraph after it")), p()), li(p()), item("Bullet after an empty bullet")),
    ol({}, li(p(t("Number with blank paragraphs around its text")), p(), p(t("and more text"))), item("Second number")),
    callout(para("Callout text."), p(), para("After a blank line in the callout.")),
    table(
      row(head("A"), head("B")),
      row(cell("x"), td()),
      row(td(p(), para("after a blank paragraph")), cell("y")),
      row(td(para("before a blank paragraph"), p()), cell("z")),
    ),
    para("Last real paragraph."),
    p(),
    p(),
  ),
});

const spacesAndBreaks = make("spaces-and-breaks", "Spaces and hard breaks", {
  body: doc(
    h(1, t("Spaces and breaks")),
    para("Two  spaces, three   spaces, and four    spaces inside a line."),
    para("   Three leading spaces."),
    para("Trailing spaces follow this.    "),
    p(t("    "), t("Spaces before a bold run: "), b("   bold with its own leading spaces"), t("   and after.")),
    p(t("Line one"), br, t("Line two"), br, t("Line three")),
    p(br, t("Starts with a hard break.")),
    p(t("Two breaks in a row"), br, br, t("end the line.")),
    p(t("Ends with two hard breaks, so two empty lines follow."), br, br),
    h(2, t("A heading"), br, t("on two lines")),
    ul(li(p(t("Bullet"), br, t("continued"))), li(p(t("   Bullet with leading spaces")))),
    ol({}, li(p(t("Number"), br, t("continued"), br, br, t("after a blank line")))),
    table(row(head("Cell"), head("Cell")), row(td(p(t("Cell"), br, t("two lines"))), td(p(t("  Indented cell"))))),
    callout(p(t("Callout"), br, t("two lines")), para("   Indented callout text.")),
    para("A\ttab becomes one space."),
    para("Line breaks\r\ninside\ntext\rnodes\u2028become\u2029breaks."),
    para("Control characters \u0001\u0007\u007f\u0085 are removed."),
  ),
});

const unicode = make("unicode-nfc-zero-width", "Unicode normalization and invisible characters", {
  variables: [variable("name", "Name", "text", true, "Zoë")],
  values: { name: "Zoe\u0308 Nu\u0308n\u0303ez" },
  body: doc(
    h(1, t("Unicode")),
    para("Decomposed: Cafe\u0301, nin\u0303o, A\u030angstro\u0308m, Zu\u0308rich."),
    p(t("A value with decomposed letters: "), v("name"), t(".")),
    para("Zero-width characters render as nothing: zero\u200bwidth\u200cjoin\u200dword\u2060join\ufeffend."),
    para("No-break space\u00a0and\u00a0narrow\u00a0stay: a\u00a0\u00a0b."),
    para("Typographic: “curly quotes”, ‘single’, en–dash, em—dash, ellipsis…, © ® ™ € £ ¥ ± × ÷ ½ ° § ¶ •."),
    para("Latin Extended and others: Łódź, Győr, Çelik, Ñandú, ΑΒΓ αβγ, АБВ абв."),
    para("Ligature words: office financial benefit affluent waffle fluff."),
  ),
});

/**
 * A soft hyphen, then minus signs and hyphens in the same paragraph and the next (review C1: fontkit
 * once kept U+00AD's glyph under "-", so every later hyphen vanished from the PDF).
 */
const softHyphen = make("characters-soft-hyphen", "A soft hyphen, then minus signs and hyphens", {
  variables: [variable("balance", "Balance", "currency", true, "-1234.50")],
  values: { balance: "-1234.50" },
  body: doc(
    p(t("Ver\u00adsicherung and in\u00adter\u00adest are one word each. A balance of "), v("balance"), t(", a change of -25 and a call to 800-555-0100.")),
    p(t("The next paragraph: "), v("balance"), t(" again, -0.5 points, and 800-555-0100.")),
  ),
});

/** Direction marks and variation selectors are invisible: removed in every channel (D3). */
const formatCharacters = make("characters-direction-and-variation", "Direction marks and variation selectors", {
  body: doc(
    para("Left\u200eto\u200eright and right\u200fto\u200fleft marks join the words."),
    para("Variation selectors: ©\ufe0f, ®\ufe0e, 1\ufe0f and the letter a\ufe0f."),
    h(2, t("A heading\u200e with a mark\ufe0f in it")),
    ul(item("\u200eA list item that starts with a mark")),
  ),
});

/** Paragraphs and a heading led by no-break spaces keep their indent in every channel (D4). */
const leadingNoBreak = make("spaces-leading-no-break", "Lines led by no-break spaces", {
  body: doc(
    para("\u00a0\u00a0\u00a0Three no-break spaces lead this paragraph."),
    para("Text between."),
    h(2, t("\u00a0\u00a0Two no-break spaces lead this heading")),
    p(t("A hard break, then"), br, t("\u00a0\u00a0two no-break spaces lead the next line.")),
    ul(item("\u00a0One no-break space leads this bullet.")),
  ),
});

/** Leads that mix ASCII and no-break spaces print each space where it was typed (D4). */
const leadingMixed = make("spaces-leading-mixed", "Lines led by mixed spaces", {
  body: doc(
    para(" \u00a0 \u00a0Space, no-break, space, no-break lead this paragraph."),
    para("\u00a0 \u00a0 No-break, space, no-break, space lead this one."),
    para("  \u00a0\u00a0Two spaces, then two no-break spaces."),
    h(3, t("\u00a0 A heading led by a no-break space and a space")),
    callout(para(" \u00a0Inside a callout.")),
  ),
});

// ── Links ────────────────────────────────────────────────────────────────────

const LONG_URL =
  "https://payments.coral.example/cardmember/servicing/payments/one-time-payment?source=agreement&campaign=spring-travel-rewards-2026&session=0123456789abcdef0123456789abcdef";

const links = make("links", "Links, allowed and refused", {
  variables: [variable("site", "Site", "text", true, "coral.example")],
  values: { site: "coral.example" },
  body: doc(
    h(1, t("Links")),
    p(t("Allowed: "), link("https", "https://coral.example/terms"), t(", "), link("http", "http://coral.example/plain"), t(", "), link("email", "mailto:help@coral.example?subject=Card%20terms"), t(", "), link("phone", "tel:+18005550100"), t(".")),
    p(t("Normalized: "), link("scheme case", "HTTPS://Coral.Example/Terms"), t(", "), link("trimmed", "  https://coral.example/trim\u00a0 "), t(", "), link("accent", "https://coral.example/café?q=é"), t(", "), link("mailto case", "MailTo:Help@Coral.Example"), t(".")),
    p(t("Refused, text stays: "), link("script", "javascript:alert(1)"), t(", "), link("relative", "/terms"), t(", "), link("no scheme", "coral.example"), t(", "), link("ftp", "ftp://coral.example/file"), t(", "), link("data", "data:text/html,hi"), t(", "), link("empty", ""), t(".")),
    p(t("Refused: "), link("space", "https://coral.example/card terms"), t(", "), link("user info", "https://bank.example@evil.example/"), t(", "), link("international host", "https://café.example/"), t(", "), link("backslash", "https://coral.example\\terms"), t(", "), link("bare tel", "tel:call-me"), t(".")),
    p(t("One link in three runs: "), t("read the ", linkMark("https://coral.example/rewards")), t("rewards", bold, linkMark("https://coral.example/rewards")), t(" ", italic, linkMark("https://coral.example/rewards")), t("rules", italic, underline, linkMark("https://coral.example/rewards")), t(".")),
    p(t("A link across a break: "), t("line one", linkMark("https://coral.example/a")), { type: "hardBreak", marks: [linkMark("https://coral.example/a")] }, t("line two", linkMark("https://coral.example/a")), t(".")),
    p(link("https://coral.example/privacy", "https://coral.example/privacy"), t(" and "), link("coral.example", "https://coral.example/"), t(" and "), link("help@coral.example", "mailto:help@coral.example"), t(" show no address twice.")),
    p(t("A variable that is a link: "), v("site", linkMark("https://coral.example/site")), t(".")),
    h(2, t("Heading with "), link("a link", "https://coral.example/heading")),
    ul(li(p(t("Bullet with "), link("a link", "https://coral.example/bullet")))),
    table(row(head("Link"), head("Where")), row(td(p(link("in a cell", "https://coral.example/cell"))), cell("Cell"))),
    callout(p(t("Callout with "), link("a link", "https://coral.example/callout"), t("."))),
    p(t("A very long link: "), link(LONG_URL, LONG_URL), t(".")),
    p(t("A very long word that must be cut without any hyphen: "), t("Supercalifragilisticexpialidocious".repeat(6))),
  ),
});

// ── Tables, callouts, headings, marks ────────────────────────────────────────

const tables = make("tables", "Tables", {
  variables: [variable("purchase_apr", "Purchase APR", "percent", true, "21.99")],
  values: { purchase_apr: "21.99" },
  body: doc(
    h(1, t("Tables")),
    para("A header row, a spanning cell, a tall cell, and cells of several kinds:"),
    table(
      row(head("Fee"), head("Amount"), head("Applies"), head("Notes")),
      row(cell("Annual fee"), cell("$95"), cell("Yearly"), cell("Billed once a year.")),
      row(span(td(para("Two paragraphs spanning three columns."), para("The second paragraph.")), 3), cell("Right")),
      row(span(cell("Tall cell"), 1, 2), cell("Row three, b"), cell("Row three, c"), td(p(link("Fee schedule", "https://coral.example/fees")))),
      row(cell("Row four, b"), td(p(t("APR "), v("purchase_apr"))), td()),
      row(th(para("Row header")), cell("Late fee"), cell("Up to $40"), cell("Never more than the minimum payment due.")),
    ),
    para("A header column and a header spanning two columns:"),
    table(
      row(span(head("Rates"), 2), head("Notes")),
      row(head("Purchases"), cell("21.99%"), cell("Variable")),
      row(head("Cash advances"), cell("29.99%"), cell("Variable")),
    ),
    para("Lists and bold text in cells:"),
    table(
      row(head("Step"), head("Detail")),
      row(cell("Open"), td(ul(item("Sign in"), item("Choose the account")))),
      row(cell("Pay"), td(ol({}, item("Pick an amount", ol({}, item("Statement balance"), item("Minimum payment"))), item("Confirm")), para("Payments post the same day."))),
      row(td(p(b("Bold cell"))), td(p(t("Mixed "), b("bold"), t(" and "), t("italic", italic), t(" text.")))),
    ),
    para("A single cell, and a header row with no body:"),
    table(row(cell("Only cell"))),
    table(row(head("Header only"), head("No body"))),
  ),
});

const twelveColumns = make("table-12-columns", "A table of 12 columns", {
  body: doc(
    h(1, t("Twelve columns")),
    table(
      row(...Array.from({ length: 12 }, (_, i) => head(`H${i + 1}`))),
      row(...Array.from({ length: 12 }, (_, i) => cell(`c${i + 1}`))),
      row(...Array.from({ length: 12 }, (_, i) => cell(`Word${i + 1} wraps`))),
      row(span(cell("A cell across all twelve columns."), 12)),
      row(span(cell("Six"), 6), span(cell("and six"), 6)),
    ),
    para("After the table."),
  ),
});

const calloutsAndRules = make("callouts-and-rules", "Callouts and rules", {
  variables: [variable("home_state", "Home state", "us_state", true, "NJ")],
  values: { home_state: "NJ" },
  body: doc(
    callout(para("A callout first.")),
    h(2, t("Notices")),
    callout(
      p(t("State terms for "), v("home_state"), t(" are in your agreement.")),
      p(b("Important:"), t(" interest starts on the transaction date.")),
      p(t("See "), link("point two", "https://coral.example/p2"), t(".")),
    ),
    callout(para("A second callout straight after the first.")),
    rule,
    para("After a horizontal rule."),
    rule,
    callout(para("A callout last.")),
  ),
});

const headingsAndMarks = make("headings-and-marks", "Headings and text marks", {
  variables: [first, variable("annual_fee", "Annual fee", "currency", true, "95")],
  values: { first_name: "Maya", annual_fee: "95" },
  body: doc(
    h(1, t("A very long document title that will not fit on a single line of the page in any reasonable typeface or size")),
    section(2, "offer_details", t("Offer for "), v("first_name")),
    h(3, t("A level three heading")),
    para("Text under it."),
    section(2, "rates_and_fees", link("Rates", "https://coral.example/rates"), t(" and fees")),
    h(2, t("Legal notices")),
    p(b("Bold"), t(" "), t("italic", italic), t(" "), t("underline", underline), t(" "), t("bold italic", bold, italic), t(" "), t("all three", bold, italic, underline)),
    p(t("Fee: "), v("annual_fee", bold), t(" for "), v("first_name", italic, underline), t(".")),
    h(2, t("Marks in a "), t("heading", bold, italic)),
  ),
});

const escaping = make("escaping", "Hostile text and values", {
  variables: [variable("a", "A", "text", true, "a"), variable("b", "B", "text", true, "b"), variable("c", "C", "text", true, "c")],
  values: {
    a: "<script>alert(1)</script>",
    b: `"><img src=x onerror=alert(1)>`,
    c: "-->]]> &amp; &lt; \\ 100% %s {0} ${x} $1 'single' {{first_name}}",
  },
  emailSubject: line(t("Hi <b>there</b> & welcome ")),
  emailPreheader: line(t('"quoted" & <tags> '), v("a")),
  body: doc(
    h(2, t("Escaping & <entities>")),
    p(v("a")),
    p(t("Hi "), v("b"), t(" & friends, it's \"quoted\".")),
    p(v("c")),
    table(row(head("Key"), head("Value")), row(cell("a"), td(p(v("a")))), row(cell("b"), td(p(v("b"))))),
    callout(p(v("b"))),
    ul(li(p(v("a")))),
  ),
});

// ── Email, values ────────────────────────────────────────────────────────────

const emailFields = make("email-subject-preheader", "Email subject and preheader", {
  variables: [
    first,
    variable("effective_date", "Effective date", "date", true, "2026-11-03"),
    variable("promo", "Promo", "text", false, ""),
  ],
  values: { first_name: "Zoë", effective_date: "2027-03-04" },
  emailSubject: line(t("  Zoë, your rate changes on   "), v("effective_date"), t("  "), v("promo"), t(" — please read & act ✓ (and then some more words so the subject is long enough to need wrapping in a mail client)  ")),
  emailPreheader: line(t("Hi "), v("first_name"), t(",   here is what is changing.  ")),
  body: doc(h(1, t("Your rate is changing")), p(t("Hello "), v("first_name"), t(". Effective "), v("effective_date"), t("."))),
});

const valuesFormats = make("values-formats", "Variable value formats", {
  variables: [
    variable("currency_whole", "Whole dollars", "currency", true, "95"),
    variable("currency_cents", "Dollars and cents", "currency", true, "1000.5"),
    variable("currency_decorated", "Decorated", "currency", true, "-$1,234.5"),
    variable("currency_zeros", "Trailing zeros", "currency", true, "1000000.00"),
    variable("currency_huge", "Huge", "currency", true, "1"),
    variable("currency_tiny", "Tiny", "currency", true, "0.000001"),
    variable("percent_three", "Three places", "percent", true, "6.875"),
    variable("percent_zero", "Trailing zero", "percent", true, "21.90"),
    variable("percent_symbol", "With symbol", "percent", true, "21.99 %"),
    variable("percent_json", "JSON number", "percent", true, "21.90"),
    variable("number_long", "Many digits", "number", true, "1.999999"),
    variable("number_grouped", "Grouped", "number", true, "1,234,567.891"),
    variable("number_json", "JSON number", "number", true, "20000"),
    variable("date_us", "US date", "date", true, "3/4/2027"),
    variable("date_words", "Spelled", "date", true, "Sept 30, 2027"),
    variable("date_iso", "ISO", "date", true, "2028-02-29"),
    variable("state_code", "State code", "us_state", true, "NJ"),
    variable("state_name", "State name", "us_state", true, "new  jersey"),
    variable("text_lines", "Text with a line break", "text", true, "Maya"),
    variable("text_spaces", "Text with spaces", "text", true, "Maya"),
  ],
  values: {
    currency_whole: "95",
    currency_cents: "1000.5",
    currency_decorated: "-$1,234.5",
    currency_zeros: "$1,000,000.00",
    currency_huge: "1000000000000000000000",
    currency_tiny: "0.000001",
    percent_three: "6.875",
    percent_zero: "21.90",
    percent_symbol: "21.99 %",
    percent_json: num("21.90"),
    number_long: "1.999999",
    number_grouped: "1,234,567.891",
    number_json: num("20000"),
    date_us: "3/4/2027",
    date_words: "Sept 30, 2027",
    date_iso: "2028-02-29",
    state_code: "NJ",
    state_name: "new  jersey",
    text_lines: "Maya\nChen",
    text_spaces: "  two  spaces  inside ",
  },
  body: doc(
    h(1, t("Value formats")),
    table(
      row(head("Variable"), head("Shown")),
      ...[
        "currency_whole",
        "currency_cents",
        "currency_decorated",
        "currency_zeros",
        "currency_huge",
        "currency_tiny",
        "percent_three",
        "percent_zero",
        "percent_symbol",
        "percent_json",
        "number_long",
        "number_grouped",
        "number_json",
        "date_us",
        "date_words",
        "date_iso",
        "state_code",
        "state_name",
        "text_lines",
        "text_spaces",
      ].map((key) => row(cell(key), td(p(v(key))))),
    ),
    p(t("In running text: "), v("percent_three"), t(" APR on "), v("currency_cents"), t(" from "), v("date_words"), t(" in "), v("state_name"), t(".")),
  ),
});

// ── Cases that must fail ─────────────────────────────────────────────────────

const glyphs = make("pdf-error-glyphs", "Characters the PDF font cannot draw", {
  variables: [variable("name", "Name", "text", true, "Maya")],
  values: { name: "Nguyễn Thị Minh" },
  body: doc(
    h(1, t("Characters")),
    para("Draws everywhere: café, Łódź, ΑΒΓ."),
    p(t("The PDF cannot draw: "), v("name"), t(", Hà Nội, Việt Nam, ạ and ₹ and ₩.")),
    ul(item("Also in a list: ₹500")),
  ),
});

const errorValues = make("error-invalid-values", "Values that do not fit", {
  variables: [
    first,
    variable("purchase_apr", "Purchase APR", "percent", true, "21.99"),
    variable("annual_fee", "Annual fee", "currency", true, "95"),
    variable("cash_fee", "Cash fee", "currency", true, "5"),
    variable("promo", "Promo", "text", false, ""),
  ],
  values: { purchase_apr: "1,00", annual_fee: "007", cash_fee: num("1e3") },
  body: doc(para("This document is never rendered.")),
});

const wideTable = make("error-table-too-wide", "A table of 13 columns", {
  body: doc(para("Before."), table(row(...Array.from({ length: 13 }, (_, i) => cell(`c${i + 1}`)))), para("After.")),
});

const deepLists = make("error-list-too-deep", "Lists nested 10 levels", {
  body: doc(para("Before."), nestedOrdered(10, "Level ten")),
});

const cellTable = make("error-table-in-cell", "A table inside a table cell", {
  body: doc(table(row(td(table(row(cell("Inner"))))))),
});

const errorHeadingLevel = make("error-heading-level", "A stored heading of level 4", {
  body: doc(h(4, t("Level four is saved as three, but a stored one is refused"))),
});

const errorListStart = make("error-list-start", "A stored list starting at 10000", {
  body: doc(ol({ start: 10000 }, item("Ten thousand"))),
});

const errorNumberingStyle = make("error-numbering-style", "A numbering style Stencil doesn't know", {
  body: doc(ol({ format: "greek" as never }, item("Alpha"))),
});

const errorTableRagged = make("error-table-ragged", "A stored table whose rows are ragged", {
  body: doc(table(row(cell("a"), cell("b")), row(cell("c")))),
});

const errorTableBadSpan = make("error-table-bad-span", "A stored table with a colspan of 0", {
  body: doc(table(row(span(cell("a"), 0)))),
});

const errorEmailField = make("error-email-field", "An email subject with a hard break", {
  emailSubject: line(t("Your rate"), br, t("is changing")),
  body: doc(para("The PDF and the web page render; the email is refused for its subject.")),
});

const errorUnknownNode = make("error-unknown-node", "A node the editor doesn't have", {
  body: doc({ type: "blockquote", content: [para("Quoted.")] }),
});

const errorMissingVariables = make("error-missing-variables", "Required values missing", {
  variables: [first, variable("purchase_apr", "Purchase APR", "percent", true, "21.99"), variable("promo", "Promo", "text", false, "")],
  values: { promo: "Spring" },
  body: doc(p(t("Hi "), v("first_name"), t(", your APR is "), v("purchase_apr"), t("."))),
});

const errorCellListHeading = make("error-heading-in-cell-list", "A heading in a list inside a table cell", {
  body: doc(table(row(td(ul(li(para("Item"), h(2, t("A heading in a cell's list")))))))),
});

// ── Documents the parity check must read as they are ─────────────────────────

/** Structures whose plain text or PDF a reduced comparison once misread (review M4/M5). */
const ordinaryStructures = make("ordinary-structures", "Ordinary structures", {
  body: doc(
    para("A cell of two paragraphs beside another cell, the lines the same length:"),
    table(row(td(para("one"), para("two")), cell("six")), row(cell("ten"), cell("won"))),
    para("A bar inside a cell:"),
    table(row(cell("a | b"), cell("c |")), row(cell("| d"), td(p(t("e"), br, t("|"))))),
    ul(li(para("A list item with a heading after its first paragraph"), h(2, t("The heading")), para("And a paragraph after it."))),
    ol({}, li(para("An ordered item"), h(3, t("A level three heading in it")))),
    p(t("A link whose text is only spaces: "), t("   ", linkMark("https://coral.example/blank")), t(" (the address shows in text).")),
    para("----------------------------------------"),
    para("A paragraph of forty dashes is above, and one of three is below:"),
    para("---"),
    p(t("A line, then dashes after a hard break"), br, t("===")),
    p(t("A zero-width space after a hard break leaves the empty line"), br, t("\u200b")),
  ),
});

// ── Pagination ───────────────────────────────────────────────────────────────

/** Several pages: headings that keep with what follows, tables that repeat their header, long lists, a callout. */
function pagination(): FocusedCase {
  const words = "interest account balance statement payment billing cycle transaction minimum purchase transfer advance annual fee rate variable prime penalty credit limit".split(" ");
  const word = (n: number) => words[n % words.length]!;
  const sentence = (n: number) =>
    `${word(n)[0]!.toUpperCase()}${word(n).slice(1)} ${word(n * 3 + 1)} and ${word(n * 7 + 2)} apply to your ${word(n * 5 + 3)} as described in this section, and ${word(n * 11 + 4)} may change without notice before the next ${word(n * 13 + 5)}.`;
  const blocks: Node[] = [h(1, t("Cardmember Agreement"))];
  for (let s = 1; s <= 8; s += 1) {
    const key = s === 1 ? "offer_details" : s === 4 ? "rates_and_fees" : s === 8 ? "legal_notices" : null;
    blocks.push(key ? section(2, key, t(`Section ${s}: ${word(s)} terms`)) : h(2, t(`Section ${s}: ${word(s)} terms`)));
    for (let k = 0; k < 3; k += 1) blocks.push(para(Array.from({ length: 2 + (k % 3) }, (_, r) => sentence(s * 10 + k + r)).join(" ")));
    if (s % 2 === 0) {
      blocks.push(
        table(
          row(head("Item"), head("Rate or fee"), head("Applies when")),
          ...Array.from({ length: 12 }, (_, r) => row(td(p(b(`${word(r + s)} ${r + 1}`))), cell(`${r + s}.25%`), cell(sentence(r + s).slice(0, 80)))),
        ),
      );
    }
    if (s % 3 === 0) blocks.push(ol({}, ...Array.from({ length: 5 }, (_, r) => item(sentence(r + s * 2), ...(r === 2 ? [ul(item("A sub-point."), item("Another sub-point."))] : [])))));
    if (s === 5) blocks.push(callout(para(sentence(77)), para(sentence(78))));
  }
  return make("pagination", "Cardmember Agreement", { body: doc(...blocks) });
}

export const FOCUSED_CASES: FocusedCase[] = [
  listsDefault,
  listsStyles,
  listsStart,
  listsMixed,
  optionalVariables,
  blankLines,
  spacesAndBreaks,
  leadingNoBreak,
  leadingMixed,
  unicode,
  softHyphen,
  formatCharacters,
  links,
  tables,
  twelveColumns,
  calloutsAndRules,
  headingsAndMarks,
  escaping,
  emailFields,
  valuesFormats,
  glyphs,
  errorValues,
  wideTable,
  deepLists,
  cellTable,
  errorHeadingLevel,
  errorListStart,
  errorNumberingStyle,
  errorTableRagged,
  errorTableBadSpan,
  errorEmailField,
  errorUnknownNode,
  errorMissingVariables,
  errorCellListHeading,
  ordinaryStructures,
  pagination(),
];
