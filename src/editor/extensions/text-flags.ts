// Flags on a field's text (InlineVariableField's `flags`): runs of text the host marks as a problem,
// underlined where they sit, each with a sentence and, when the host has one, a one-click fix. Stencil
// flags the characters an SMS can't carry and links on public shorteners; the editor knows nothing of
// that, only ranges, sentences and replacements.
//
//   • The host's function gets the field's text as `fieldText` makes it (each variable chip a space,
//     each line break "\n") and returns flags as offsets into it. It runs on every edit.
//   • Each flag is an inline decoration, <span class="ucomp-flag" data-flag="i">. A flag on text that
//     draws nothing (a zero-width space) is also `data-invisible`, so it still shows (styles.css).
//   • Its popover (components/flag-popover.tsx) opens on a click on the flag, or when the caret is moved
//     onto it without typing (arrows, Home and End, a click). An edit closes it, and so do the caret
//     leaving the flag, Esc and focus leaving the field (unless it went into the popover).
//   • While it is open, Tab moves focus into it, to its fix; Esc there, or Tab again, comes back.
//   • A fix is one ordinary transaction (`applyFlagFix`): the flagged text replaced, or removed for an
//     empty replacement. Undo puts it back.

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { FlagPopoverStore } from "../state/flag-popover";
import type { TextFlag, TextFlagger } from "../types";

export const FLAG_CLASS = "ucomp-flag";

/** A flag where it sits in the document: `from` and `to` are positions. */
export interface PlacedFlag extends Omit<TextFlag, "from" | "to"> {
  from: number;
  to: number;
}

interface FlagsState {
  flags: readonly PlacedFlag[];
  decorations: DecorationSet;
}

export const textFlagsKey = new PluginKey<FlagsState>("textFlags");

/** A transaction meta that recomputes the flags without an edit (the host's function changed). */
export const REFRESH_FLAGS = "refresh";

/**
 * The field's text as a flagger reads it: its text, each variable chip a space, each line break (a
 * hard break, or between paragraphs) "\n". `starts[i]` is the document position of character i.
 */
export function fieldText(doc: PMNode): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  let blocks = 0;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (blocks++ > 0) {
        text += "\n";
        starts.push(pos);
      }
      return true;
    }
    if (node.isText) {
      const value = node.text ?? "";
      for (let i = 0; i < value.length; i++) starts.push(pos + i);
      text += value;
      return false;
    }
    if (node.isLeaf) {
      text += node.type.name === "hardBreak" ? "\n" : " ";
      starts.push(pos);
      return false;
    }
    return true;
  });
  return { text, starts };
}

/** Text that draws nothing on its own: zero-width and joining characters, a soft hyphen. */
const INVISIBLE = /^[\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]+$/u;

/** The host's flags, placed in `doc` and in document order: a flag outside the text, or empty, is dropped. */
export function placeFlags(doc: PMNode, flagger: TextFlagger | null): PlacedFlag[] {
  if (!flagger) return [];
  const { text, starts } = fieldText(doc);
  const placed: PlacedFlag[] = [];
  for (const flag of flagger(text)) {
    if (!(flag.from >= 0 && flag.to > flag.from && flag.to <= text.length)) continue;
    placed.push({ ...flag, from: starts[flag.from]!, to: starts[flag.to - 1]! + 1 });
  }
  return placed.sort((a, b) => a.from - b.from || a.to - b.to);
}

function decorate(doc: PMNode, flags: readonly PlacedFlag[]): DecorationSet {
  return DecorationSet.create(
    doc,
    flags.map((flag, i) => {
      const invisible = INVISIBLE.test(doc.textBetween(flag.from, flag.to, "\n", " "));
      return Decoration.inline(flag.from, flag.to, {
        class: FLAG_CLASS,
        "data-flag": String(i),
        ...(invisible ? { "data-invisible": "" } : {}),
      });
    }),
  );
}

/** The flags in `state`, as placed. */
export function flagsOf(state: EditorState): readonly PlacedFlag[] {
  return textFlagsKey.getState(state)?.flags ?? [];
}

/** The flag at a position (its edges included), preferring one the position is inside. */
export function flagAt(flags: readonly PlacedFlag[], pos: number): number | null {
  let edge: number | null = null;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    if (pos > flag.from && pos < flag.to) return i;
    if (edge === null && (pos === flag.from || pos === flag.to)) edge = i;
  }
  return edge;
}

/**
 * Applies flag `index`'s fix: its text replaced with `replacement`, or removed when that is "". One
 * transaction, in the undo history. False when the flag has no fix or the field can't be edited.
 */
export function applyFlagFix(view: EditorView, index: number): boolean {
  const flag = flagsOf(view.state)[index];
  if (!flag || flag.replacement === undefined || !view.editable) return false;
  const tr =
    flag.replacement === ""
      ? view.state.tr.delete(flag.from, flag.to)
      : view.state.tr.insertText(flag.replacement, flag.from, flag.to);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Holds a field's current flagger for the plugin to read on every edit; `set` says whether it changed. */
export interface FlaggerSource {
  get: () => TextFlagger | null;
  set: (next: TextFlagger | null) => boolean;
}

export function createFlaggerSource(initial: TextFlagger | null): FlaggerSource {
  let current = initial;
  return {
    get: () => current,
    set: (next) => {
      if (next === current) return false;
      current = next;
      return true;
    },
  };
}

export interface TextFlagsOptions {
  /** The host's current flagger (read on every edit, so it can change between renders), or null. */
  flagger: () => TextFlagger | null;
  store: FlagPopoverStore | null;
}

export const TextFlags = Extension.create<TextFlagsOptions>({
  name: "textFlags",

  addOptions() {
    return { flagger: () => null, store: null };
  },

  addProseMirrorPlugins() {
    const { flagger, store } = this.options;
    const compute = (doc: PMNode): FlagsState => {
      const flags = placeFlags(doc, flagger());
      return { flags, decorations: decorate(doc, flags) };
    };
    const popup = () => store?.getState() ?? null;

    return [
      new Plugin<FlagsState>({
        key: textFlagsKey,
        state: {
          init: (_config, state) => compute(state.doc),
          apply: (tr, previous, _old, state) =>
            tr.docChanged || tr.getMeta(textFlagsKey) === REFRESH_FLAGS ? compute(state.doc) : previous,
        },
        props: {
          decorations: (state) => textFlagsKey.getState(state)?.decorations,

          handleClick: (view, pos) => {
            const index = flagAt(flagsOf(view.state), pos);
            if (index !== null) popup()?.open(index);
            return false; // ProseMirror still places the caret
          },

          handleKeyDown: (_view, event) => {
            const open = popup();
            if (!open || open.index === null) return false;
            if (event.key === "Escape") {
              open.close();
              return true;
            }
            if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
              const target = open.element?.querySelector<HTMLElement>("button:not([disabled])");
              if (!target) return false;
              event.preventDefault();
              target.focus();
              return true;
            }
            return false;
          },

          handleDOMEvents: {
            blur: (_view, event) => {
              const open = popup();
              const next = event.relatedTarget;
              if (open && open.index !== null && !(next instanceof Node && open.element?.contains(next))) open.close();
              return false;
            },
          },
        },

        view: (editorView) => {
          // The popover never takes focus, so a screen reader hears its sentence from a polite live region
          // instead, present from the start (as the required-section note's is).
          const host = editorView.dom.parentElement;
          const live = host ? editorView.dom.ownerDocument.createElement("div") : null;
          if (live && host) {
            live.className = "sr-only";
            live.setAttribute("role", "status");
            live.setAttribute("aria-live", "polite");
            host.appendChild(live);
          }
          const unsubscribe = store?.subscribe((state, before) => {
            if (!live) return;
            if (state.index === null) live.textContent = "";
            else if (state.index !== before.index) live.textContent = flagsOf(editorView.state)[state.index]?.message ?? "";
          });
          return {
            update: (view, previous) => {
              const open = popup();
              if (!open) return;
              if (view.state.doc !== previous.doc) {
                // Typing closes it, and the flags it pointed at are new.
                open.close();
                return;
              }
              if (view.state.selection.eq(previous.selection)) return;
              // The caret moved without an edit: onto a flag opens it, off one closes it.
              const { selection } = view.state;
              const index = selection.empty ? flagAt(flagsOf(view.state), selection.head) : null;
              if (index === null) open.close();
              else if (view.hasFocus()) open.open(index);
            },
            destroy: () => {
              popup()?.close();
              unsubscribe?.();
              live?.remove();
            },
          };
        },
      }),
    ];
  },
});
