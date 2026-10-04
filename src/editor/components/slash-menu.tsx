"use client";

// The `/` block menu UI. The Suggestion plugin (extensions/slash-command.ts) drives a tiny
// per-editor store through `render`; this component subscribes to it and only mounts (cmdk and
// all) while the menu is open. Focus stays in the document: ↑ ↓ Enter Tab Esc come through the
// plugin's onKeyDown, so the menu is fully keyboard-driven without stealing the caret.

import type { Editor } from "@tiptap/react";
import type { SuggestionMount, SuggestionProps } from "@tiptap/suggestion";
import {
  Heading1,
  Heading2,
  Heading3,
  Info,
  List,
  ListOrdered,
  Minus,
  Table2,
  Text,
  type LucideIcon,
} from "lucide-react";
import { LazyMotion, domMax, m } from "motion/react";
import { useEffect, useId, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { Command, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import type { BlockItem, BlockItemId, ShortcutToken } from "../extensions/block-items";
import type { SlashRender } from "../extensions/slash-command";
import { viewDom } from "../lib/editor-view";
import { makeRoomBelow, menuContainer } from "./menu-layer";

const ICONS: Record<BlockItemId, LucideIcon> = {
  text: Text,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  bulletList: List,
  orderedList: ListOrdered,
  table: Table2,
  callout: Info,
  divider: Minus,
};

type Props = SuggestionProps<BlockItem, BlockItem>;

interface SlashState {
  /** Latest props from the Suggestion plugin; null when closed. */
  props: Props | null;
  /** The mount helper of the current session (positions + dismisses on outside click). */
  mount: SuggestionMount | null;
  /** Bumps on every open so the menu re-mounts and re-runs its entrance. */
  session: number;
  items: BlockItem[];
  index: number;
}

const CLOSED: Pick<SlashState, "props" | "mount" | "items" | "index"> = {
  props: null,
  mount: null,
  items: [],
  index: 0,
};

export interface SlashMenuController {
  store: StoreApi<SlashState>;
  render: SlashRender;
  /**
   * The + button just inserted a "/" line: if the menu then closes with nothing chosen and nothing
   * typed, undo that insertion so dismissing leaves the document as it was.
   */
  armUndo: (editor: Editor) => void;
}

/** One per editor. Pass `render` to editorExtensions() and `controller` to <SlashMenu>. */
export function createSlashMenuController(): SlashMenuController {
  const store = createStore<SlashState>()(() => ({ ...CLOSED, session: 0 }));
  let armed: { editor: Editor; doc: Editor["state"]["doc"] } | null = null;

  const disarmOnExit = () => {
    const pending = armed;
    armed = null;
    if (!pending) return;
    // After the plugin's update settles; only if the document is exactly as the + left it.
    setTimeout(() => {
      const { editor, doc } = pending;
      if (!editor.isDestroyed && editor.state.doc === doc) editor.commands.undo();
    }, 0);
  };

  const render: SlashRender = () => ({
    onStart: (props) => {
      store.setState((s) => ({
        props,
        mount: props.mount,
        session: s.session + 1,
        items: props.loading ? [] : props.items,
        index: 0,
      }));
    },
    onUpdate: (props) => {
      // While the next query's items resolve, keep showing the previous ones (no flicker).
      store.setState(props.loading ? { props } : { props, items: props.items, index: 0 });
    },
    onExit: () => {
      store.setState(CLOSED);
      disarmOnExit();
    },
    onKeyDown: ({ event }) => {
      const { props, items, index } = store.getState();
      if (!props || items.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        store.setState({ index: (index + step + items.length) % items.length });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item) props.command(item);
        return true;
      }
      return false;
    },
  });

  const armUndo = (editor: Editor) => {
    armed = { editor, doc: editor.state.doc };
  };

  return { store, render, armUndo };
}

const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function keyLabels(tokens: readonly ShortcutToken[]): string[] {
  const apple = isApple();
  return tokens.map((t) => {
    if (t === "Mod") return apple ? "⌘" : "Ctrl";
    if (t === "Alt") return apple ? "⌥" : "Alt";
    if (t === "Shift") return apple ? "⇧" : "Shift";
    return t;
  });
}

const KEYCAP =
  "h-5 min-w-5 rounded-md border border-hairline bg-surface-sunken px-1 font-sans text-[11px] font-medium text-text-muted";

// Where the menu waits (invisible) until Suggestion's mount() places it at the caret.
const PARKED = { position: "fixed", top: 0, left: 0, visibility: "hidden" } as const;

const HIGHLIGHT_SPRING = { type: "spring", stiffness: 560, damping: 44, mass: 0.9 } as const;

export function SlashMenu({ controller, editor }: { controller: SlashMenuController; editor: Editor }) {
  const open = useStore(controller.store, (s) => s.props !== null && s.items.length > 0);
  const session = useStore(controller.store, (s) => s.session);
  if (!open) return null;
  return <SlashMenuPanel key={session} controller={controller} editor={editor} />;
}

function SlashMenuPanel({ controller, editor }: { controller: SlashMenuController; editor: Editor }) {
  const { store } = controller;
  const items = useStore(store, (s) => s.items);
  const index = useStore(store, (s) => s.index);
  const mount = useStore(store, (s) => s.mount);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const highlightId = useId();

  // Anchor to the `/query` decoration; Suggestion's mount keeps it placed on scroll/resize and
  // closes the menu on an outside click.
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

  // Screen readers: the document keeps focus, so point it at the active option.
  useEffect(() => {
    const dom = viewDom(editor);
    if (!element || !dom) return;
    const list = element.querySelector<HTMLElement>("[cmdk-list]");
    const option = element.querySelector<HTMLElement>('[cmdk-item][data-selected="true"]');
    if (list && option) keepInView(list, option);
    if (list?.id) dom.setAttribute("aria-controls", list.id);
    if (option?.id) dom.setAttribute("aria-activedescendant", option.id);
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [element, editor, index, items]);

  const selected = items[index]?.id;
  const choose = (item: BlockItem) => store.getState().props?.command(item);

  return createPortal(
    <div
      ref={setElement}
      style={PARKED}
      className="z-50"
      onMouseDown={(event) => event.preventDefault()}
    >
      <LazyMotion features={domMax} strict>
        <m.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="w-64 rounded-xl border border-hairline bg-surface shadow-pop"
        >
          <Command
            label="Insert block"
            shouldFilter={false}
            loop
            value={selected ?? ""}
            onValueChange={(value) => {
              const next = items.findIndex((item) => item.id === value);
              if (next >= 0 && next !== store.getState().index) store.setState({ index: next });
            }}
            className="rounded-xl! bg-transparent p-1"
          >
            <CommandList className="max-h-[min(22rem,calc(var(--ucomp-menu-max-h,22rem)-0.75rem))] scroll-py-1">
              {items.map((item) => {
                const Icon = ICONS[item.id];
                const isSelected = item.id === selected;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => choose(item)}
                    className="relative isolate gap-2.5 rounded-lg px-1.5 py-1 text-text data-selected:bg-transparent"
                  >
                    {isSelected ? (
                      <m.span
                        layoutId={highlightId}
                        transition={HIGHLIGHT_SPRING}
                        className="absolute inset-0 -z-10 rounded-lg bg-hover"
                      />
                    ) : null}
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface text-text-muted">
                      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="truncate text-sm">{item.label}</span>
                    {item.shortcut || item.markdown ? (
                      <CommandShortcut className="tracking-normal">
                        <KbdGroup className="gap-0.5">
                          {(item.shortcut ? keyLabels(item.shortcut) : [item.markdown!]).map((key, i) => (
                            <Kbd key={`${key}-${i}`} className={KEYCAP}>
                              {key}
                            </Kbd>
                          ))}
                        </KbdGroup>
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </m.div>
      </LazyMotion>
    </div>,
    menuContainer(editor),
  );
}

/** Scrolls only the list (never the page) so the active option stays visible. */
function keepInView(list: HTMLElement, option: HTMLElement) {
  const l = list.getBoundingClientRect();
  const o = option.getBoundingClientRect();
  if (o.top < l.top) list.scrollTop -= l.top - o.top;
  else if (o.bottom > l.bottom) list.scrollTop += o.bottom - l.bottom;
}
