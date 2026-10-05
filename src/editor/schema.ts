// The single extension list. The client editor, the server static renderer, import and the
// render resolver all build their schema from here, so they can't drift apart.
//
// baseExtensions()         server-safe: node/mark specs + behavior plugins, no React NodeViews.
// editorExtensions()       client: base + chip NodeView, placeholder, `/` and `{{` menus, the
//                          required-section guard, block moves, the field binding (usage, drop,
//                          chip popover), Home/End and review-thread highlights.
// inlineFieldExtensions()  a one-line field (email subject, preheader): text + chips only.

import { Node, type Extensions, type JSONContent } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { UniqueID, generateUniqueIds } from "@tiptap/extension-unique-id";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";
import type { Variable as VariableModel } from "./model/types";
import type { VariableStore } from "./state/variable-store";
import { BlockMove } from "./extensions/block-move";
import { BlockRangeHighlight } from "./extensions/block-range-highlight";
import { Callout } from "./extensions/callout";
import { FieldBindingExtension, type FieldBinding } from "./extensions/field-binding";
import { LineBoundaryKeys } from "./extensions/line-boundary-keys";
import { ReviewThreads, type ReviewThreadsOptions } from "./extensions/review-threads";
import { SingleLine } from "./extensions/single-line";
import { DEFAULT_REQUIRED_NOTE, RequiredSections } from "./extensions/required-sections";
import { SlashCommand, type SlashRender } from "./extensions/slash-command";
import { Variable } from "./extensions/variable";
import { variableSuggestion, type VariablePickerRender, type VariableSuggestion } from "./extensions/variable-picker";
import { VariableWithChip } from "./extensions/variable-view";
import { variableLeafText } from "./lib/threads";

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
  suggestion?: VariableSuggestion | null;
  /** Client: enforce the required-section guard, with this note. */
  requiredGuard?: { note: () => string } | null;
}

function createLookup(opts: BaseExtensionOptions): (key: string) => VariableModel | undefined {
  if (opts.lookup) return opts.lookup;
  const byKey = new Map((opts.variables ?? []).map((v) => [v.key, v]));
  return (key) => byKey.get(key);
}

function variableNode(opts: InternalBaseOptions) {
  const VariableNode = opts.variableNode ?? Variable;
  return VariableNode.configure({
    lookup: createLookup(opts),
    store: opts.store ?? null,
    ...(opts.suggestion ? { suggestion: opts.suggestion } : {}),
  });
}

function buildBase(opts: InternalBaseOptions): Extensions {
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
        // Only URLs written with their protocol turn into links on their own (typed or pasted).
        // Otherwise a pasted <a href="https://…">example.com</a> would be re-linked to http://.
        shouldAutoLink: (url) => /^[a-z][a-z0-9+.-]*:\/\//i.test(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      // Colored by styles.css (.ucomp-dropcursor) so it follows the brand token.
      dropcursor: { color: false, width: 2, class: "ucomp-dropcursor" },
    }),
    TableKit.configure({
      // Same DOM as the editor's TableView (div.tableWrapper > table) so static and live match.
      table: { resizable: false, renderWrapper: true },
    }),
    opts.requiredGuard ? RequiredSections.configure({ guard: true, note: opts.requiredGuard.note }) : RequiredSections,
    Callout,
    variableNode(opts),
    UniqueID.configure({ attributeName: "id", types: [...BLOCK_ID_TYPES] }),
  ];
}

/** Server-safe extensions: schema, commands and plugins. No React. */
export function baseExtensions(opts: BaseExtensionOptions = {}): Extensions {
  return buildBase(opts);
}

export interface EditorExtensionOptions {
  /** The root's variable store; chips read labels and types from it. */
  store: VariableStore;
  /** The `/` menu renderer. Omit to turn the menu off. */
  slashRender?: SlashRender | null;
  /** The `{{` picker renderer. Omit to turn the picker off. */
  pickerRender?: VariablePickerRender | null;
  /** Ties the editor to its <EditorRoot> (usage, focus, drop, chip popover). */
  binding?: FieldBinding | null;
  /** The note shown when the required-section guard steps in. Default "Required for disclosures". */
  requiredNote?: () => string;
  /** Review threads: where they come from and where clicks and the caret's thread go. */
  reviewThreads?: Omit<Partial<ReviewThreadsOptions>, "leafText"> | null;
}

function clientVariableOptions({ store, pickerRender }: EditorExtensionOptions): InternalBaseOptions {
  return {
    store,
    lookup: (key) => store.getState().byKey.get(key),
    variableNode: VariableWithChip,
    suggestion: pickerRender ? variableSuggestion({ store, render: pickerRender }) : null,
  };
}

/** Client extensions: base + UI behaviors. Call once per editor instance. */
export function editorExtensions(options: EditorExtensionOptions): Extensions {
  return [
    ...buildBase({
      ...clientVariableOptions(options),
      requiredGuard: { note: options.requiredNote ?? (() => DEFAULT_REQUIRED_NOTE) },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "paragraph" ? EMPTY_LINE_PLACEHOLDER : ""),
      showOnlyCurrent: true,
      showOnlyWhenEditable: true,
      includeChildren: false,
    }),
    SlashCommand.configure({ render: options.slashRender ?? null }),
    BlockRangeHighlight,
    BlockMove,
    FieldBindingExtension.configure({ binding: options.binding ?? null }),
    LineBoundaryKeys,
    ReviewThreads.configure({
      ...Object.fromEntries(Object.entries(options.reviewThreads ?? {}).filter(([, value]) => value !== undefined)),
      leafText: variableLeafText((key) => options.store.getState().byKey.get(key)),
    }),
  ];
}

// ── One-line fields (InlineVariableField) ────────────────────────

/** A document of exactly one paragraph. */
const InlineDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "paragraph",
});

function buildInline(opts: InternalBaseOptions): Extensions {
  return [
    InlineDocument,
    StarterKit.configure({
      document: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      hardBreak: false,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      link: false,
      gapcursor: false,
      trailingNode: false,
      dropcursor: { color: false, width: 2, class: "ucomp-dropcursor" },
    }),
    variableNode(opts),
  ];
}

/** Client extensions of a one-line field: the same `{{` picker, drop and chips as the document. */
export function inlineFieldExtensions(options: EditorExtensionOptions): Extensions {
  return [
    ...buildInline(clientVariableOptions(options)),
    FieldBindingExtension.configure({ binding: options.binding ?? null }),
    LineBoundaryKeys,
    SingleLine,
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
