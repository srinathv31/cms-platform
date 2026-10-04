"use client";

// The `{{` variable picker. Same architecture as the `/` menu (slash-menu.tsx): the variable
// node's Suggestion plugin drives a tiny per-editor store through `render`, and this component
// mounts (cmdk and all) only while the picker is open. Focus stays in the document while the list
// shows: ↑ ↓ Enter Tab Esc arrive through the plugin's onKeyDown.
//
// "Create" is pinned at the bottom, carrying the query. Choosing it turns the picker into the
// compact variable form (focus moves into it); saving creates the variable and puts its chip where
// `{{query` was, in one step. Esc goes back to the list.

import type { Editor } from "@tiptap/react";
import type { SuggestionMount, SuggestionProps } from "@tiptap/suggestion";
import { Plus } from "lucide-react";
import { LazyMotion, domMax, m } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import type { PickerItem, VariablePickerRender } from "../extensions/variable-picker";
import { cx } from "../lib/cx";
import { newDraft } from "../model/draft";
import type { Variable } from "../model/types";
import type { EditorRootRuntime } from "../state/editor-root";
import { viewDom } from "../lib/editor-view";
import { makeRoomBelow, menuContainer } from "./menu-layer";
import { TYPE_ICONS } from "./type-icon";
import { VariableForm } from "./variable-form";

type Props = SuggestionProps<PickerItem, PickerItem>;

interface PickerState {
  /** Latest props from the Suggestion plugin; null when closed. */
  props: Props | null;
  /** The mount helper of the current session (positions the picker at the `{{query`). */
  mount: SuggestionMount | null;
  /** Bumps on every open so the picker re-mounts and re-runs its entrance. */
  session: number;
  items: PickerItem[];
  index: number;
  mode: "list" | "create";
}

const CLOSED: Pick<PickerState, "props" | "mount" | "items" | "index" | "mode"> = {
  props: null,
  mount: null,
  items: [],
  index: 0,
  mode: "list",
};

export interface VariablePickerController {
  store: StoreApi<PickerState>;
  render: VariablePickerRender;
}

const CREATE_VALUE = "\u0000create";

function choose(store: StoreApi<PickerState>, item: PickerItem | undefined) {
  if (!item) return;
  if (item.kind === "create") store.setState({ mode: "create" });
  else store.getState().props?.command(item);
}

/** One per editor. Pass `render` to the extensions and `controller` to <VariablePicker>. */
export function createVariablePickerController(): VariablePickerController {
  const store = createStore<PickerState>()(() => ({ ...CLOSED, session: 0 }));

  const render: VariablePickerRender = () => ({
    onStart: (props) => {
      store.setState((s) => ({
        props,
        mount: props.mount,
        session: s.session + 1,
        items: props.loading ? [] : props.items,
        index: 0,
        mode: "list",
      }));
    },
    onUpdate: (props) => {
      const queryChanged = props.query !== store.getState().props?.query;
      // While the next query's items resolve, keep showing the previous ones (no flicker).
      store.setState(
        props.loading
          ? { props }
          : { props, items: props.items, index: 0, ...(queryChanged ? { mode: "list" as const } : {}) },
      );
    },
    onExit: () => store.setState(CLOSED),
    onKeyDown: ({ event }) => {
      const { props, items, index, mode } = store.getState();
      if (!props || mode !== "list" || items.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        store.setState({ index: (index + step + items.length) % items.length });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        choose(store, items[index]);
        return true;
      }
      return false;
    },
  });

  return { store, render };
}

// Where the menu waits (invisible) until Suggestion's mount() places it at the caret.
const PARKED = { position: "fixed", top: 0, left: 0, visibility: "hidden" } as const;

const HIGHLIGHT_SPRING = { type: "spring", stiffness: 560, damping: 44, mass: 0.9 } as const;

const TILE = "flex size-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface text-text-muted";

interface PickerProps {
  controller: VariablePickerController;
  editor: Editor;
  root: EditorRootRuntime;
}

export function VariablePicker({ controller, editor, root }: PickerProps) {
  const open = useStore(controller.store, (s) => s.props !== null && s.items.length > 0);
  const session = useStore(controller.store, (s) => s.session);
  if (!open) return null;
  return <VariablePickerPanel key={session} controller={controller} editor={editor} root={root} />;
}

function VariablePickerPanel({ controller, editor, root }: PickerProps) {
  const { store } = controller;
  const mode = useStore(store, (s) => s.mode);
  const mount = useStore(store, (s) => s.mount);
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  // Anchor to the `{{query` decoration; Suggestion's mount keeps it placed on scroll and resize.
  // Room below first (menu-layer.ts), then placed.
  useLayoutEffect(() => {
    const dom = viewDom(editor);
    if (!element || !mount || !dom) return;
    let unmount: (() => void) | null = null;
    const rect = store.getState().props?.clientRect?.() ?? null;
    const cancel = makeRoomBelow(dom, rect, element.offsetHeight, 6, () => {
      unmount = mount(element);
    });
    return () => {
      cancel();
      unmount?.();
    };
  }, [element, mount, store, editor]);

  return createPortal(
    <div
      ref={setElement}
      style={PARKED}
      className="z-50"
      // The form takes focus: then the picker is a small dialog.
      role={mode === "create" ? "dialog" : undefined}
      aria-label={mode === "create" ? "New variable" : undefined}
      // The list keeps focus in the document; the form needs real focus.
      onMouseDown={mode === "list" ? (event) => event.preventDefault() : undefined}
    >
      <LazyMotion features={domMax} strict>
        <m.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className={cx(
            "w-72 rounded-xl border border-hairline bg-surface shadow-pop",
            mode === "create" && "max-h-(--ucomp-menu-max-h) overflow-y-auto",
          )}
        >
          {mode === "list" ? (
            <PickerList controller={controller} editor={editor} element={element} />
          ) : (
            <PickerCreate controller={controller} editor={editor} root={root} />
          )}
        </m.div>
      </LazyMotion>
    </div>,
    menuContainer(editor),
  );
}

function PickerList({ controller, editor, element }: { controller: VariablePickerController; editor: Editor; element: HTMLDivElement | null }) {
  const { store } = controller;
  const items = useStore(store, (s) => s.items);
  const index = useStore(store, (s) => s.index);
  const highlightId = useId();

  // Screen readers: the document keeps focus, so point it at the active option.
  useEffect(() => {
    const dom = viewDom(editor);
    if (!element || !dom) return;
    const list = element.querySelector<HTMLElement>("[cmdk-list]");
    const option = element.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
    if (list && option && list.contains(option)) keepInView(list, option);
    if (list?.id) dom.setAttribute("aria-controls", list.id);
    if (option?.id) dom.setAttribute("aria-activedescendant", option.id);
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [element, editor, index, items]);

  const variables = items.filter((item): item is Extract<PickerItem, { kind: "variable" }> => item.kind === "variable");
  const create = items.find((item): item is Extract<PickerItem, { kind: "create" }> => item.kind === "create");
  const valueOf = (item: PickerItem | undefined) => (item ? (item.kind === "create" ? CREATE_VALUE : item.variable.key) : "");
  const selected = valueOf(items[index]);

  const highlight = (value: string) =>
    value === selected ? (
      <m.span layoutId={highlightId} transition={HIGHLIGHT_SPRING} className="absolute inset-0 -z-10 rounded-lg bg-hover" />
    ) : null;

  return (
    <Command
      label="Insert variable"
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={(value) => {
        const next = items.findIndex((item) => valueOf(item) === value);
        if (next >= 0 && next !== store.getState().index) store.setState({ index: next });
      }}
      className="rounded-xl! bg-transparent p-0"
    >
      <CommandList className="max-h-[min(18rem,calc(var(--ucomp-menu-max-h,20rem)-0.5rem))] scroll-pt-1 scroll-pb-12">
        {variables.length ? (
          <div className="p-1">
            {variables.map((item) => {
              const Icon = TYPE_ICONS[item.variable.type];
              return (
                <CommandItem
                  key={item.variable.key}
                  value={item.variable.key}
                  onSelect={() => choose(store, item)}
                  className="relative isolate gap-2.5 rounded-lg px-1.5 py-1 text-text data-selected:bg-transparent"
                >
                  {highlight(item.variable.key)}
                  <span className={TILE}>
                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.variable.label}</span>
                  <span className="max-w-[45%] shrink-0 truncate font-mono text-[11.5px] text-text-muted">{item.variable.key}</span>
                </CommandItem>
              );
            })}
          </div>
        ) : null}
        {create ? (
          // Pinned to the bottom of the list, always in view.
          <div className={cx("sticky bottom-0 bg-surface p-1", variables.length > 0 && "border-t border-hairline")}>
            <CommandItem
              value={CREATE_VALUE}
              onSelect={() => choose(store, create)}
              className="relative isolate gap-2.5 rounded-lg px-1.5 py-1 text-text data-selected:bg-transparent"
            >
              {highlight(CREATE_VALUE)}
              <span className={TILE}>
                <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {create.label ? (
                  <>
                    Create <span className="text-text-muted">“</span>
                    {create.label}
                    <span className="text-text-muted">”</span>
                  </>
                ) : (
                  "Create variable"
                )}
              </span>
            </CommandItem>
          </div>
        ) : null}
      </CommandList>
    </Command>
  );
}

function PickerCreate({ controller, editor, root }: PickerProps) {
  const { store } = controller;
  const query = useStore(store, (s) => s.props?.query ?? "");
  const takenKeys = useMemo(() => new Set(root.variables.getState().variables.map((v) => v.key)), [root]);
  const [initial] = useState(() => newDraft(query, takenKeys));

  const back = () => {
    store.setState({ mode: "list" });
    if (!editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false });
  };

  const create = (variable: Variable) => {
    const result = root.createVariable(variable);
    if (result.ok) store.getState().props?.command({ kind: "variable", variable });
    return result;
  };

  return (
    <div className="p-3.5">
      <p className="caps-label mb-3">New variable</p>
      <VariableForm mode="create" initial={initial} takenKeys={takenKeys} onSubmit={create} onCancel={back} />
    </div>
  );
}

/** Scrolls only the list (never the page) so the active option stays visible. */
function keepInView(list: HTMLElement, option: HTMLElement) {
  const l = list.getBoundingClientRect();
  const o = option.getBoundingClientRect();
  if (o.top < l.top) list.scrollTop -= l.top - o.top;
  else if (o.bottom > l.bottom) list.scrollTop += o.bottom - l.bottom;
}
