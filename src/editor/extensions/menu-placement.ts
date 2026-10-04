// Shared behavior of the `/` menu and the `{{` picker: placement (TipTap Suggestion's Floating UI config).
// Fixed strategy: a menu is never outside the viewport, even before its first position lands, so
// focus or scroll-into-view inside it can never scroll the page. `shift` keeps it inside the
// editor's column; `size` publishes the room left on the chosen side as --ucomp-menu-max-h, so a
// menu that fits neither below nor above the caret scrolls inside instead of being cut off.

import { shift, size } from "@floating-ui/dom";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { PluginKey } from "@tiptap/pm/state";
import type { SuggestionFloatingUiOptions, SuggestionOptions } from "@tiptap/suggestion";

const VIEWPORT_PADDING = 8;

/**
 * The column a menu must stay inside horizontally: the editor's wrapper (or an inline field's
 * box), where menus are rendered (components/menu-layer.ts). So a menu opened at the end of a long
 * line slides back over the text instead of hanging into the next column (a side rail).
 */
export function menuBoundary(floating: Element): Element | "clippingAncestors" {
  return floating.closest(".ucomp-editor, .ucomp-field") ?? "clippingAncestors";
}

export const MENU_FLOATING_UI: SuggestionFloatingUiOptions = {
  strategy: "fixed",
  middleware: [
    shift(({ elements }) => ({ padding: VIEWPORT_PADDING, boundary: menuBoundary(elements.floating) })),
    size({
      padding: VIEWPORT_PADDING,
      apply({ availableHeight, elements }) {
        elements.floating.style.setProperty("--ucomp-menu-max-h", `${Math.max(160, Math.floor(availableHeight))}px`);
      },
    }),
  ],
};

/**
 * Menus open from typing only. Undo and redo can bring back a raw `{{query` or `/query`, and moving
 * the caret into one shouldn't pop a menu open either; once open, a menu follows its query.
 */
export function showOnTyping(pluginKey: PluginKey): NonNullable<SuggestionOptions["shouldShow"]> {
  return ({ editor, transaction }) => {
    // During `apply` the editor still holds the previous state: was this menu already open?
    const wasActive = (pluginKey.getState(editor.state) as { active?: boolean } | undefined)?.active;
    if (wasActive) return true;
    return transaction.docChanged && !isHistoryTransaction(transaction);
  };
}
