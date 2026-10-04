// The block catalogue behind the `/` menu (and, in Phase 2, the + button's menu).
// Pure data + TipTap commands; the React menu maps `icon` keys to lucide icons.

import type { ChainedCommands, Editor } from "@tiptap/core";

export type BlockItemId =
  | "text"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "table"
  | "callout"
  | "divider";

/** Shortcut tokens. "Mod" is ⌘ on Apple platforms and Ctrl elsewhere. */
export type ShortcutToken = "Mod" | "Alt" | "Shift" | (string & {});

export interface BlockItem {
  id: BlockItemId;
  label: string;
  /** Extra words the filter matches ("h2", "ul", "hr"…). */
  keywords: readonly string[];
  /** A keyboard shortcut that does the same thing (wired by StarterKit). */
  shortcut?: readonly ShortcutToken[];
  /** A Markdown-style input rule that does the same thing, shown as a single keycap. */
  markdown?: string;
  /** Hidden when it can't apply at the cursor (no tables in tables, no headings in callouts…). */
  isAvailable: (editor: Editor) => boolean;
  /** Applies the block, chained after the `/query` text has been removed. */
  apply: (chain: ChainedCommands) => ChainedCommands;
}

const inTable = (editor: Editor) => editor.isActive("table");

export const BLOCK_ITEMS: readonly BlockItem[] = [
  {
    id: "text",
    label: "Text",
    keywords: ["paragraph", "plain", "body", "p"],
    shortcut: ["Mod", "Alt", "0"],
    // Listed on a plain line too (Notion does); choosing it there is a harmless no-op.
    isAvailable: (editor) => editor.isActive("paragraph") || editor.can().setParagraph(),
    apply: (chain) => chain.setParagraph(),
  },
  ...([1, 2, 3] as const).map<BlockItem>((level) => ({
    id: `heading${level}`,
    label: `Heading ${level}`,
    keywords: ["heading", "title", "section", `h${level}`],
    shortcut: ["Mod", "Alt", String(level)],
    isAvailable: (editor) => editor.can().setHeading({ level }),
    apply: (chain) => chain.setHeading({ level }),
  })),
  {
    id: "bulletList",
    label: "Bulleted list",
    keywords: ["bullet", "unordered", "ul", "list", "-"],
    shortcut: ["Mod", "Shift", "8"],
    isAvailable: (editor) => !editor.isActive("bulletList") && editor.can().toggleBulletList(),
    apply: (chain) => chain.toggleBulletList(),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    keywords: ["numbered", "ordered", "ol", "list", "1."],
    shortcut: ["Mod", "Shift", "7"],
    isAvailable: (editor) => !editor.isActive("orderedList") && editor.can().toggleOrderedList(),
    apply: (chain) => chain.toggleOrderedList(),
  },
  {
    id: "table",
    label: "Table",
    keywords: ["table", "grid", "rows", "columns", "fees"],
    isAvailable: (editor) => !inTable(editor) && !editor.isActive("callout"),
    apply: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  {
    id: "callout",
    label: "Callout",
    keywords: ["callout", "notice", "note", "box", "important", "info"],
    isAvailable: (editor) => !inTable(editor) && editor.can().setCallout(),
    apply: (chain) => chain.setCallout(),
  },
  {
    id: "divider",
    label: "Divider",
    keywords: ["divider", "rule", "line", "separator", "hr"],
    markdown: "---",
    isAvailable: (editor) => editor.can().setHorizontalRule(),
    apply: (chain) => chain.setHorizontalRule(),
  },
];

/**
 * Filters by label words and keywords (prefix match), best matches first:
 * label starts with the query, then a label word does, then a keyword does.
 */
export function filterBlockItems(items: readonly BlockItem[], query: string, editor: Editor): BlockItem[] {
  const q = query.trim().toLowerCase();
  const available = items.filter((item) => safeAvailable(item, editor));
  if (!q) return available;

  const scored: { item: BlockItem; score: number }[] = [];
  for (const item of available) {
    const label = item.label.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.split(/\s+/).some((word) => word.startsWith(q))) score = 1;
    else if (label.replace(/\s+/g, "").startsWith(q)) score = 1;
    else if (item.keywords.some((k) => k.startsWith(q))) score = 2;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item);
}

function safeAvailable(item: BlockItem, editor: Editor): boolean {
  try {
    return item.isAvailable(editor);
  } catch {
    return false;
  }
}
