// The single extension list. The client editor, the server static renderer, import and the
// render resolver all build their schema from here, so they can't drift apart.
//
// baseExtensions()   server-safe: node/mark specs + behavior plugins, no React NodeViews.
// editorExtensions() client: base + chip NodeView, placeholder, `/` menu, drag highlight.

import type { Extensions, JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { UniqueID, generateUniqueIds } from "@tiptap/extension-unique-id";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";
import type { Variable as VariableModel } from "./model/types";
import type { VariableStore } from "./state/variable-store";
import { BlockRangeHighlight } from "./extensions/block-range-highlight";
import { Callout } from "./extensions/callout";
import { RequiredSections } from "./extensions/required-sections";
import { SlashCommand, type SlashRender } from "./extensions/slash-command";
import { Variable } from "./extensions/variable";
import { VariableWithChip } from "./extensions/variable-view";

/** Node types that get a stable `attrs.id` (comment anchors, redline, margin threads). */
export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "table",
  "callout",
  "horizontalRule",
] as const;

/** The only placeholder text in the product. */
export const EMPTY_LINE_PLACEHOLDER = "Type / for blocks";

export interface BaseExtensionOptions {
  /** Variables used to label chips in HTML output (static render, clipboard, render pipeline). */
  variables?: readonly VariableModel[];
  /** Alternative to `variables`: resolve a key on demand. */
  lookup?: (key: string) => VariableModel | undefined;
}

interface InternalBaseOptions extends BaseExtensionOptions {
  variableNode?: typeof Variable;
  store?: VariableStore | null;
}

function createLookup(opts: BaseExtensionOptions): (key: string) => VariableModel | undefined {
  if (opts.lookup) return opts.lookup;
  const byKey = new Map((opts.variables ?? []).map((v) => [v.key, v]));
  return (key) => byKey.get(key);
}

function buildBase(opts: InternalBaseOptions): Extensions {
  const VariableNode = opts.variableNode ?? Variable;
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      strike: false,
      blockquote: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      // Colored by styles.css (.ucomp-dropcursor) so it follows the brand token.
      dropcursor: { color: false, width: 2, class: "ucomp-dropcursor" },
    }),
    TableKit.configure({
      // Same DOM as the editor's TableView (div.tableWrapper > table) so static and live match.
      table: { resizable: false, renderWrapper: true },
    }),
    RequiredSections,
    Callout,
    VariableNode.configure({ lookup: createLookup(opts), store: opts.store ?? null }),
    UniqueID.configure({ attributeName: "id", types: [...BLOCK_ID_TYPES] }),
  ];
}

/** Server-safe extensions: schema, commands and plugins. No React. */
export function baseExtensions(opts: BaseExtensionOptions = {}): Extensions {
  return buildBase(opts);
}

export interface EditorExtensionOptions {
  /** The editor's variable store; chips read labels and types from it. */
  store: VariableStore;
  /** The `/` menu renderer. Omit to turn the menu off. */
  slashRender?: SlashRender | null;
}

/** Client extensions: base + UI behaviors. Call once per editor instance. */
export function editorExtensions({ store, slashRender = null }: EditorExtensionOptions): Extensions {
  return [
    ...buildBase({
      store,
      lookup: (key) => store.getState().byKey.get(key),
      variableNode: VariableWithChip,
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "paragraph" ? EMPTY_LINE_PLACEHOLDER : ""),
      showOnlyCurrent: true,
      showOnlyWhenEditable: true,
      includeChildren: false,
    }),
    SlashCommand.configure({ render: slashRender }),
    BlockRangeHighlight,
  ];
}

/**
 * Adds `attrs.id` to every block that lacks one (same rules as the live editor).
 * Use it in seeds, import and server-side writes so block ids are stable before the editor
 * ever opens the document.
 */
export function ensureBlockIds(doc: JSONContent): JSONContent {
  return generateUniqueIds(doc, baseExtensions());
}
