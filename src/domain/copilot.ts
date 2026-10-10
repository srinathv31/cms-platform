// The Copilot prompt (Phase 7a). There is no AI in the app: the author copies this prompt into
// Copilot and pastes the answer back into the document, where the editor turns its Markdown into
// structure, its `{{key}}` placeholders into chips, and its required headings into the existing
// sections (src/editor/paste). So the prompt asks for exactly what that paste understands.
//
// Pure and deterministic: the same input always gives the same text (snapshot-tested).

import { TYPE_META } from "@/editor/model/variables";
import type { CopilotPrompt, CopilotPromptInput } from "./import-types";
import { UNTITLED_TEMPLATE_NAME } from "./lifecycle";
import { REQUEST_REFUSALS } from "./refusals";
import { CHANNELS, type Channel, type ChannelFamily, type JSONContent, type RequiredSection } from "./types";

/**
 * How the prompt names a channel. Copilot writes a document's body, so only a document's channels
 * (PDF, web, email) reach the prompt; a message template has no body to write.
 */
const CHANNEL_NAMES: Record<Channel, string> = {
  pdf: "PDF",
  web: "web page",
  email: "email",
  push: "push notification",
  sms: "SMS",
};

/**
 * Why a template of this family gets no Copilot prompt, or null. Copilot writes a document's body, and an
 * alert has none: its fields are a few lines each, written in the composer. The rail shows the Copilot row
 * disabled with this reason, and the prompt's read refuses with it.
 */
export function copilotUnavailable(family: ChannelFamily): string | null {
  return family === "document" ? null : REQUEST_REFUSALS.copilotDocumentsOnly.reason;
}

/** "a", "a and b", "a, b and c" (the product's lists). */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ── Document → Markdown ──────────────────────────────────────────

type Mark = NonNullable<JSONContent["marks"]>[number];

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  href: string | null;
}

/** Characters that would read as Markdown syntax inside text. */
function escapeText(text: string): string {
  return text.replace(/([\\*`[\]])/g, "\\$1");
}

function runOf(node: JSONContent): Run | null {
  const marks: Mark[] = node.marks ?? [];
  const has = (type: string) => marks.some((mark) => mark.type === type);
  const link = marks.find((mark) => mark.type === "link");
  const base = { bold: has("bold"), italic: has("italic"), href: typeof link?.attrs?.href === "string" ? link.attrs.href : null };
  if (node.type === "text") return { text: escapeText(node.text ?? ""), ...base };
  if (node.type === "variable" && typeof node.attrs?.key === "string") return { text: `{{${node.attrs.key}}}`, ...base };
  if (node.type === "hardBreak") return { text: "\\\n", bold: false, italic: false, href: null };
  return null;
}

/** Wraps a run's text in its marks, keeping its outer spaces outside the markers (`** a**` isn't bold). */
function wrap(text: string, open: string, close = open): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return match[2] ? `${match[1]}${open}${match[2]}${close}${match[3]}` : text;
}

/** Inline content → Markdown: chips as `{{key}}`, **bold**, *italic*, [links](href). Underline has no Markdown. */
function inlineMarkdown(content: JSONContent[] | undefined): string {
  const runs: Run[] = [];
  for (const node of content ?? []) {
    const run = runOf(node);
    if (!run) continue;
    const last = runs.at(-1);
    // Neighbours with the same marks read as one run.
    if (last && last.bold === run.bold && last.italic === run.italic && last.href === run.href) last.text += run.text;
    else runs.push(run);
  }
  return runs
    .map((run) => {
      let text = run.text;
      if (run.italic) text = wrap(text, "*");
      if (run.bold) text = wrap(text, "**");
      if (run.href) text = wrap(text, "[", `](${run.href})`);
      return text;
    })
    .join("");
}

/** The text of a block's paragraphs, one line (table cells). */
function cellText(cell: JSONContent): string {
  return (cell.content ?? [])
    .map((block) => inlineMarkdown(block.content).replace(/\\\n/g, " "))
    .filter(Boolean)
    .join(" ")
    .replace(/\|/g, "\\|");
}

function tableMarkdown(table: JSONContent): string[] {
  const rows = (table.content ?? []).map((row) => (row.content ?? []).map(cellText));
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  // Markdown needs a header row: the first row is it (the editor marks header cells there too).
  return [line(rows[0]), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)];
}

function listMarkdown(list: JSONContent, indent: string): string[] {
  const ordered = list.type === "orderedList";
  let number = typeof list.attrs?.start === "number" ? list.attrs.start : 1;
  const lines: string[] = [];
  for (const item of list.content ?? []) {
    const marker = ordered ? `${number++}.` : "-";
    const inner = indent + " ".repeat(marker.length + 1);
    let first = true;
    for (const block of item.content ?? []) {
      if (block.type === "bulletList" || block.type === "orderedList") {
        lines.push(...listMarkdown(block, inner));
        continue;
      }
      const text = inlineMarkdown(block.content).replace(/\\\n/g, `\\\n${inner}`);
      lines.push(first ? `${indent}${marker} ${text}` : `${inner}${text}`);
      first = false;
    }
    if (first) lines.push(`${indent}${marker}`);
  }
  return lines;
}

/** One top-level block → Markdown lines, or null when it holds nothing. */
function blockMarkdown(block: JSONContent): string[] | null {
  switch (block.type) {
    case "heading": {
      const text = inlineMarkdown(block.content);
      if (!text) return null;
      const level = Math.min(Math.max(Number(block.attrs?.level) || 2, 1), 3);
      return [`${"#".repeat(level)} ${text.replace(/\\\n/g, " ")}`];
    }
    case "paragraph": {
      const text = inlineMarkdown(block.content);
      return text.trim() ? [text] : null;
    }
    case "bulletList":
    case "orderedList":
      return listMarkdown(block, "");
    case "table":
      return tableMarkdown(block);
    case "horizontalRule":
      return ["---"];
    case "callout": {
      // A callout has no Markdown of its own: its paragraphs.
      const lines = (block.content ?? []).flatMap((child) => blockMarkdown(child) ?? []);
      return lines.length ? lines : null;
    }
    default:
      return null;
  }
}

/**
 * A document body (TipTap JSON) as Markdown: `#`–`###` headings, paragraphs, `-` and `1.` lists
 * (nested by indent), pipe tables (the first row is the header), `---` rules, **bold**, *italic*,
 * [links](href), and chips as `{{key}}`. Empty lines are dropped; blocks are separated by a blank line.
 */
export function documentToMarkdown(body: JSONContent): string {
  return (body.content ?? [])
    .map(blockMarkdown)
    .filter((lines): lines is string[] => lines !== null)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}

/** True when the body has text or chips outside its required headings (a draft to improve). */
function hasDraftText(body: JSONContent): boolean {
  const filled = (node: JSONContent): boolean =>
    (node.type === "text" && !!node.text?.trim()) || node.type === "variable" || (node.content ?? []).some(filled);
  return (body.content ?? []).some((block) => !(block.type === "heading" && block.attrs?.requiredKey) && filled(block));
}

// ── The prompt ───────────────────────────────────────────────────

/** A heading's plain text, as the editor reads it (`textContent`): text runs only. */
function plainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(plainText).join("");
}

/**
 * The section headings the prompt asks for: the draft's own required headings, in document order
 * and with the draft's own titles, because that is what the paste matches an answer against (a draft
 * keeps its headings when the content type's sections are renamed later). A section of the content
 * type that the draft lacks, or whose heading is empty, falls back to the content type's title; a
 * missing one goes after the section that precedes it in the content type.
 */
export function promptSections(body: JSONContent, typeSections: readonly RequiredSection[]): RequiredSection[] {
  const typeTitle = new Map(typeSections.map((section) => [section.key, section.title]));
  const sections: RequiredSection[] = [];
  for (const block of body.content ?? []) {
    const key = block.type === "heading" ? block.attrs?.requiredKey : null;
    if (typeof key !== "string" || key === "" || sections.some((section) => section.key === key)) continue;
    const title = plainText(block).replace(/\s+/g, " ").trim();
    const fallback = typeTitle.get(key);
    if (title || fallback) sections.push({ key, title: title || fallback! });
  }
  typeSections.forEach((section, index) => {
    if (sections.some((s) => s.key === section.key)) return;
    const before = typeSections
      .slice(0, index)
      .map((earlier) => sections.findIndex((s) => s.key === earlier.key))
      .reduce((last, at) => Math.max(last, at), -1);
    sections.splice(before + 1, 0, { key: section.key, title: section.title });
  });
  return sections;
}

/** True when the first thing in the draft is a heading (rather than, say, a greeting above the first section). */
function opensWithHeading(body: JSONContent): boolean {
  for (const block of body.content ?? []) {
    const lines = blockMarkdown(block);
    if (lines) return block.type === "heading";
  }
  return false;
}

/**
 * The prompt for Copilot: what the template is, its required sections as `##` headings (exactly, in
 * order, titled as the draft titles them: `promptSections`), its variables as `{{key}}` placeholders, the rules that keep the answer pasteable, then the
 * current draft as Markdown ("Improve this draft") when it has text, else "Write the body now."
 *
 * A template still called "Untitled template" is sent without a name (the placeholder isn't a title
 * Copilot should write to). A draft that opens with a greeting keeps its opening, rather than being
 * told to start at the first heading.
 */
export function buildCopilotPrompt(input: CopilotPromptInput): CopilotPrompt {
  const kind = input.contentTypeName.toLowerCase();
  const channels = CHANNELS.filter((channel) => input.channels.includes(channel)).map((channel) => CHANNEL_NAMES[channel]);
  const includesDraft = hasDraftText(input.body);
  const named = input.templateName.trim() !== "" && input.templateName.trim() !== UNTITLED_TEMPLATE_NAME;

  const lines: string[] = [`Help me write the body of a ${kind} for ${input.teamName}.`, ""];
  if (named) lines.push(`Template: ${input.templateName}`);
  lines.push(`Team: ${input.teamName}`, `Content type: ${input.contentTypeName}`);
  if (channels.length) lines.push(`Published as: ${andList(channels)}`);

  const sections = promptSections(input.body, input.requiredSections);
  if (sections.length) {
    lines.push("", "Use these section headings, exactly as written and in this order:");
    for (const section of sections) lines.push(`## ${section.title}`);
  }

  lines.push("");
  if (input.variables.length) {
    lines.push("Placeholders for customer-specific values (write each exactly as shown, double braces included):");
    for (const variable of input.variables) {
      const need = variable.required ? "required" : "optional";
      lines.push(`- {{${variable.key}}}: ${variable.label} (${TYPE_META[variable.type].label}, ${need})`);
    }
  } else {
    lines.push("There are no placeholders yet.");
  }

  lines.push(
    "",
    "Rules:",
    input.variables.length
      ? "- Use only these placeholders for customer-specific values. If you need a new one, write it as {{lowercase_snake_case}}."
      : "- Write customer-specific values as placeholders: {{lowercase_snake_case}}.",
    "- Leave every {{placeholder}} and every {{#if …}} or {{/if}} tag exactly as written: never rename it, translate it or fill in a value.",
    "- Do not invent rates, fees or legal terms; use a {{placeholder}}.",
    "- Use plain language a customer understands.",
    "- Answer in Markdown only: ## headings, paragraphs, - lists and pipe tables.",
    includesDraft && !opensWithHeading(input.body)
      ? "- No preamble and no closing remarks: keep the draft's opening as it is."
      : "- No preamble and no closing remarks: start with the first heading.",
    "",
  );

  if (includesDraft) lines.push("Improve this draft:", "", documentToMarkdown(input.body));
  else lines.push("Write the body now.");

  return { text: lines.join("\n"), includesDraft };
}
