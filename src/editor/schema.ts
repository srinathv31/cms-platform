// The single extension list. The client editor, the server static renderer, import and the
// render resolver all build their schema from here, so they can't drift apart.
//
// baseExtensions()         server-safe: node/mark specs + behavior plugins, no React NodeViews.
// editorExtensions()       client: base + chip NodeView, placeholder, `/` and `{{` menus, the
//                          required-section guard, the section-merging paste, block moves, the
//                          field binding (usage, drop, chip popover, paste), Home/End,
//                          review-thread highlights and list markers.
// inlineFieldExtensions()  a channel field (email subject, push title, SMS message): text + chips only,
//                          on one line, or keeping its line breaks as hard breaks; with the host's
//                          text flags when it has any.

import { Extension, InputRule, Node, type Extensions, type JSONContent } from "@tiptap/core";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import { UniqueID, generateUniqueIds } from "@tiptap/extension-unique-id";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";
import { normalizeLink } from "./model/links";
import { ORDERED_LIST_ATTRS, isMarkerDelimiter, isMarkerFormat } from "./model/list-markers";
import { CELL_BLOCKS, HEADING_LEVELS } from "./model/normalize";
import type { Variable as VariableModel } from "./model/types";
import type { VariableStore } from "./state/variable-store";
import { BlockMove } from "./extensions/block-move";
import { BlockRangeHighlight } from "./extensions/block-range-highlight";
import { Callout } from "./extensions/callout";
import { ContentLimits } from "./extensions/content-limits";
import { FieldBindingExtension, type FieldBinding } from "./extensions/field-binding";
import { LineBoundaryKeys } from "./extensions/line-boundary-keys";
import { ListMarkers } from "./extensions/list-markers";
import { ReviewThreads, type ReviewThreadsOptions } from "./extensions/review-threads";
import { SingleLine } from "./extensions/single-line";
import { FieldLines } from "./extensions/field-lines";
import type { CharacterRules } from "./model/characters";
import type { FieldLines as FieldLinesMode } from "./model/normalize";
import { DEFAULT_REQUIRED_NOTE, RequiredSections } from "./extensions/required-sections";
import { SectionPaste } from "./extensions/section-paste";
import { SlashCommand, type SlashRender } from "./extensions/slash-command";
import { TextFlags, type TextFlagsOptions } from "./extensions/text-flags";
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

/**
 * An ordered list's numbering style (docs/render-spec.md, "Lists and markers"), stored on the
 * orderedList node under the names in `ORDERED_LIST_ATTRS` (model/list-markers.ts). Null (or absent)
 * means "default for the list's ordered depth": 1. → a. → i. for the format, "period" for the
 * delimiter. Rendered as data attributes so the editor can style them; TipTap's own `type`
 * attribute is not used.
 */
const ListNumbering = Extension.create({
  name: "listNumbering",

  addGlobalAttributes() {
    return [
      {
        types: ["orderedList"],
        attributes: {
          [ORDERED_LIST_ATTRS.format]: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute("data-marker-format");
              return isMarkerFormat(value) ? value : null;
            },
            renderHTML: (attributes) => {
              const value = attributes[ORDERED_LIST_ATTRS.format];
              return isMarkerFormat(value) ? { "data-marker-format": value } : {};
            },
          },
          [ORDERED_LIST_ATTRS.delimiter]: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute("data-marker-delimiter");
              return isMarkerDelimiter(value) ? value : null;
            },
            renderHTML: (attributes) => {
              const value = attributes[ORDERED_LIST_ATTRS.delimiter];
              return isMarkerDelimiter(value) ? { "data-marker-delimiter": value } : {};
            },
          },
        },
      },
    ];
  },
});

/**
 * Table cells hold paragraphs and lists only (docs/render-spec.md §2): no tables, headings, rules or
 * callouts inside a cell. Paste and import move or convert anything else (model/normalize.ts).
 */
export const CELL_CONTENT = `(${CELL_BLOCKS.join(" | ")})+`;
const ParagraphsAndListsCell = TableCell.extend({ content: CELL_CONTENT });
const ParagraphsAndListsHeader = TableHeader.extend({ content: CELL_CONTENT });

/**
 * Typing "1. " to "9999. " at the start of a line starts a numbered list from that number. A longer
 * number stays text: a list starts at 0 to 9999 (LIST_START_MAX), and typing never makes a list the
 * document check would refuse.
 */
export const ORDERED_LIST_INPUT = /^(\d{1,4})\.\s$/;

/**
 * StarterKit, with the numbered list's typed rule on ORDERED_LIST_INPUT (TipTap's own takes any
 * number of digits). The rule is otherwise TipTap's: it wraps the line, or joins the list just above
 * when the number continues it.
 */
const Kit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((extension) =>
      extension instanceof Node && extension.name === "orderedList"
        ? extension.extend({
            addInputRules() {
              return (this.parent?.() ?? []).map(
                (rule) => new InputRule({ find: ORDERED_LIST_INPUT, handler: rule.handler, undoable: rule.undoable }),
              );
            },
          })
        : extension,
    );
  },
});

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
    Kit.configure({
      heading: { levels: [...HEADING_LEVELS] },
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
        // One link check everywhere (model/links.ts): what the editor links, every channel links.
        isAllowedUri: (url) => normalizeLink(url) !== null,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
      // Colored by styles.css (.ucomp-dropcursor) so it follows the brand token.
      dropcursor: { color: false, width: 2, class: "ucomp-dropcursor" },
    }),
    TableKit.configure({
      // Same DOM as the editor's TableView (div.tableWrapper > table) so static and live match.
      table: { resizable: false, renderWrapper: true },
      tableCell: false,
      tableHeader: false,
    }),
    ParagraphsAndListsCell,
    ParagraphsAndListsHeader,
    ContentLimits,
    opts.requiredGuard ? RequiredSections.configure({ guard: true, note: opts.requiredGuard.note }) : RequiredSections,
    ListNumbering,
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
  /** A channel field's flags (InlineVariableField's `flags`): the host's flagger and the popover's store. */
  textFlags?: TextFlagsOptions | null;
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
    SectionPaste,
    BlockRangeHighlight,
    BlockMove,
    FieldBindingExtension.configure({ binding: options.binding ?? null }),
    LineBoundaryKeys,
    ListMarkers,
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

/**
 * `lines`: the field keeps its line breaks (an SMS message), so its schema has the hard break. `characters`:
 * which characters a paste keeps (model/characters.ts; `"message"` for a push's or an SMS's field).
 */
function buildInline(opts: InternalBaseOptions, lines: FieldLinesMode, characters: CharacterRules): Extensions {
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
      // Shift+Enter and Mod+Enter add one; FieldLines makes Enter add one too.
      hardBreak: lines === "lines" ? { keepMarks: false } : false,
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
    ContentLimits.configure({ field: lines, characters }),
  ];
}

/**
 * Client extensions of a channel field: the same `{{` picker, drop and chips as the document. On one
 * line (`"line"`, the default: an email subject, a push title or body), Enter adds nothing; keeping its
 * line breaks (`"lines"`, an SMS message), Enter adds a hard break. A message's field (`characters:
 * "message"`, a push's or an SMS's) keeps the invisible characters in what is pasted into it.
 */
export function inlineFieldExtensions(
  options: EditorExtensionOptions,
  lines: FieldLinesMode = "line",
  characters: CharacterRules = "document",
): Extensions {
  return [
    ...buildInline(clientVariableOptions(options), lines, characters),
    FieldBindingExtension.configure({ binding: options.binding ?? null }),
    LineBoundaryKeys,
    lines === "lines" ? FieldLines : SingleLine,
    ...(options.textFlags ? [TextFlags.configure(options.textFlags)] : []),
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
