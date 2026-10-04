// The `/` block menu, on TipTap's Suggestion utility (the engine Mention uses).
// This extension is behavior only; the React menu is injected through `render`
// (components/slash-menu.tsx), so the schema stays server-safe.

import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";
import { BLOCK_ITEMS, filterBlockItems, type BlockItem } from "./block-items";

export const slashCommandPluginKey = new PluginKey("slashCommand");

export type SlashRender = NonNullable<SuggestionOptions<BlockItem, BlockItem>["render"]>;

export interface SlashCommandOptions {
  items: readonly BlockItem[];
  /** The menu UI. Without it the extension adds nothing (e.g. read-only or server use). */
  render: SlashRender | null;
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { items: BLOCK_ITEMS, render: null };
  },

  addProseMirrorPlugins() {
    const { render, items } = this.options;
    if (!render) return [];
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: "/",
        placement: "bottom-start",
        offset: { mainAxis: 6 },
        // Fixed: the menu is never outside the viewport, even before its first position lands,
        // so focus/scroll-into-view inside it can never scroll the page.
        floatingUi: { strategy: "fixed" },
        items: ({ query, editor }) => filterBlockItems(items, query, editor),
        command: ({ editor, range, props: item }) => {
          item.apply(editor.chain().focus().deleteRange(range)).run();
        },
        render,
      }),
    ];
  },
});
