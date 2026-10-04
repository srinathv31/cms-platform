// The `{{` picker's behavior, on the variable node's Suggestion (Mention's engine). The React
// picker (components/variable-picker.tsx) is injected through `render`, so this stays UI-free.
//
// The query may contain spaces ("{{Offer end date"). It ends the picker when it starts with a
// space, contains a closing "}}" or grows past a key's length.

import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { NODE, type Variable } from "../model/types";
import { filterVariables } from "../model/variables";
import type { VariableStore } from "../state/variable-store";
import { MENU_FLOATING_UI, showOnTyping } from "./menu-placement";

export type PickerItem = { kind: "variable"; variable: Variable } | { kind: "create"; label: string };

export type VariablePickerRender = NonNullable<SuggestionOptions<PickerItem, PickerItem>["render"]>;

export type VariableSuggestion = Omit<SuggestionOptions<PickerItem, PickerItem>, "editor">;

export const variablePickerPluginKey = new PluginKey("variablePicker");

const MAX_QUERY = 64;

/** Whether text typed after `{{` still reads as a picker query. */
export function isPickerQuery(query: string): boolean {
  return query.length <= MAX_QUERY && !/^\s/.test(query) && !query.includes("}}") && !query.includes("{{");
}

/**
 * Matching variables (best first), then "Create", pinned last. Create is left out when the query
 * already names a variable exactly (its label, any case, or its key): that one is the answer, and
 * creating it again would only make a duplicate.
 */
export function pickerItems(variables: readonly Variable[], query: string): PickerItem[] {
  const label = query.trim().replace(/\s+/g, " ");
  const matches = filterVariables(variables, query).map<PickerItem>((variable) => ({ kind: "variable", variable }));
  const lower = label.toLowerCase();
  const exact = lower !== "" && variables.some((v) => v.label.trim().toLowerCase() === lower || v.key === lower);
  return exact ? matches : [...matches, { kind: "create", label }];
}

/** Inserts the chosen variable's chip over the `{{query` text and returns focus to the field. */
export function insertPicked(editor: Editor, range: { from: number; to: number }, item: PickerItem) {
  if (item.kind !== "variable") return;
  editor.chain().insertVariable(item.variable.key, range).focus(undefined, { scrollIntoView: true }).run();
}

export function variableSuggestion({ store, render }: { store: VariableStore; render: VariablePickerRender }): VariableSuggestion {
  return {
    char: "{{",
    pluginKey: variablePickerPluginKey,
    allowSpaces: true,
    // `{{` opens the picker anywhere, even right after a word or a "$".
    allowedPrefixes: null,
    placement: "bottom-start",
    offset: { mainAxis: 6 },
    // Fixed and sized to the room on its side of the caret, like the `/` menu.
    floatingUi: MENU_FLOATING_UI,
    shouldShow: showOnTyping(variablePickerPluginKey),
    items: ({ query }) => pickerItems(store.getState().variables, query),
    command: ({ editor, range, props }) => insertPicked(editor, range, props),
    allow: ({ state, range, editor }) => {
      if (!editor.isEditable) return false;
      const type = state.schema.nodes[NODE.variable];
      if (!state.doc.resolve(range.from).parent.type.contentMatch.matchType(type)) return false;
      return isPickerQuery(state.doc.textBetween(range.from, range.to).slice(2));
    },
    render,
  };
}
