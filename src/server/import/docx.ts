import { generateJSON } from "@tiptap/html/server";
import { IMPORT_LIMITS, type ConvertResult, type ImportDrop } from "@/domain/import-types";
import type { JSONContent } from "@/domain/types";
import { normalizePastedHtml } from "@/editor/paste/normalize-html";
import { baseExtensions } from "@/editor/schema";
import { allowlistHtml, stripNotes, withDom } from "./dom";
import { isolatedDocx, type IsolationOptions } from "./isolate";
import { hasAscii } from "./sniff";
import { checkZip } from "./zip-limits";

// .docx → schema JSON, through mammoth's HTML and the editor's paste normalizer (the same cleanup a
// paste from Word gets), plus the allowlisted HTML the Original tab shows. Word's Title style is an
// H1 (it becomes the template's name). Images, comments, footnotes, headers and footers and Word
// styles we don't map are counted for the report.
//
// A .docx is a zip, so a small upload can inflate to gigabytes. Two guards before the DOM work here:
// the zip's own size claims are checked first (zip-limits.ts), then mammoth runs in a worker thread
// with a heap limit and a timeout (isolate.ts). Either refuses as `unreadable`.

const UNMAPPED_STYLE = /^Unrecognised paragraph style: '(.+)' \(Style ID: .*\)$/;

export async function convertDocx(bytes: Uint8Array, isolation?: IsolationOptions): Promise<ConvertResult> {
  const zip = checkZip(bytes);
  if (!zip.ok) {
    console.error(`Import: refused a .docx before opening it (${zip.why})`);
    return { ok: false, code: "unreadable" };
  }
  const result = await isolatedDocx(bytes, isolation);
  if (!result.ok) return result;
  const images = result.images;

  const styles = [
    ...new Set(result.messages.map((m) => UNMAPPED_STYLE.exec(m)?.[1]).filter((name): name is string => Boolean(name))),
  ];

  return withDom((parse): ConvertResult => {
    const root = parse(`<body>${result.html}</body>`).body;
    const notes = stripNotes(root);
    const text = root.textContent ?? "";
    if (text.length > IMPORT_LIMITS.maxChars) return { ok: false, code: "tooLong" };
    if (!text.trim()) return { ok: false, code: "empty" };

    const compareHtml = allowlistHtml(root, IMPORT_LIMITS.maxCompareImageBytes);
    const clean = normalizePastedHtml(root.innerHTML, { parse });
    const body = generateJSON(clean, baseExtensions()) as JSONContent;

    const dropped: ImportDrop[] = [];
    if (images) dropped.push({ kind: "images", count: images });
    if (notes.comments) dropped.push({ kind: "comments", count: notes.comments });
    if (notes.footnotes) dropped.push({ kind: "footnotes", count: notes.footnotes });
    if (hasAscii(bytes, "word/header") || hasAscii(bytes, "word/footer")) dropped.push({ kind: "headers_footers" });
    if (styles.length) dropped.push({ kind: "styles", names: styles });

    return { ok: true, file: { kind: "docx", body, compareHtml, dropped } };
  });
}
