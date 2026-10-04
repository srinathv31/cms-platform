"use client";

// Table controls: while the caret is in a table, a small button sits on the table's top border
// (right side) and opens a compact menu: insert rows and columns, delete them, delete the table.
// Tab / Shift+Tab move between cells and Tab in the last cell adds a row (TableKit's own keys), so
// the keyboard reaches the button with Alt+F10 (the usual "go to the editor's toolbar" key) and
// returns with Esc.
// Selection state comes from a useEditorState selector, so typing in a cell re-renders nothing.

import { useEditorState, type Editor } from "@tiptap/react";
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  ChevronDown,
  Columns3,
  Rows3,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TableCommand =
  | "addRowBefore"
  | "addRowAfter"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable";

interface Action {
  command: TableCommand;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
}

const GROUPS: Action[][] = [
  [
    { command: "addRowBefore", label: "Insert row above", icon: BetweenHorizontalStart },
    { command: "addRowAfter", label: "Insert row below", icon: BetweenHorizontalEnd },
    { command: "addColumnBefore", label: "Insert column left", icon: BetweenVerticalStart },
    { command: "addColumnAfter", label: "Insert column right", icon: BetweenVerticalEnd },
  ],
  [
    { command: "deleteRow", label: "Delete row", icon: Rows3 },
    { command: "deleteColumn", label: "Delete column", icon: Columns3 },
  ],
  [{ command: "deleteTable", label: "Delete table", icon: Trash2, danger: true }],
];

/** Position before the table the selection is in, or null. */
function tableAt(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "table") return $from.before(d);
  }
  return null;
}

export function TableMenu({ editor }: { editor: Editor }) {
  const tablePos = useEditorState({ editor, selector: ({ editor: e }) => (e.isEditable ? tableAt(e) : null) });
  if (tablePos === null || editor.isDestroyed) return null;
  return <TableMenuButton key={tablePos} editor={editor} tablePos={tablePos} />;
}

function TableMenuButton({ editor, tablePos }: { editor: Editor; tablePos: number }) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  // Positioned in the editor's own wrapper (rendered by React, unlike EditorContent's element).
  const frame = editor.view.dom.closest<HTMLElement>(".ucomp-editor");
  const trigger = useRef<HTMLButtonElement>(null);

  // Alt+F10 in the table moves focus to the button.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F10" || !event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      trigger.current?.focus();
    };
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  // Follows the table as it grows (rows, columns) and the page as it reflows.
  useLayoutEffect(() => {
    const table = editor.view.nodeDOM(tablePos);
    if (!(table instanceof HTMLElement) || !frame) return;
    const place = () => {
      const t = table.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      setStyle({ top: t.top - f.top, right: f.right - t.right + 8 });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(table);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [editor, tablePos, frame]);

  if (!style || !frame) return null;

  const run = (command: TableCommand) => {
    editor.chain().focus()[command]().run();
  };

  return (
    <div className="absolute z-10 -translate-y-1/2" style={style}>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label="Table options"
          aria-keyshortcuts="Alt+F10"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            editor.commands.focus();
          }}
          // Mouse presses don't focus it (the caret stays in the cell), so any focus is the keyboard's.
          className="flex h-6 items-center gap-0.5 rounded-md border border-hairline bg-surface px-1.5 text-text-muted transition-colors outline-none hover:bg-hover hover:text-text focus:outline-2 focus:outline-solid focus:outline-offset-2 focus:outline-ring data-popup-open:bg-hover data-popup-open:text-text"
          onMouseDown={(event) => event.preventDefault()}
        >
          <Table2 className="size-3.5" strokeWidth={1.75} aria-hidden />
          <ChevronDown className="size-3" strokeWidth={1.75} aria-hidden />
        </DropdownMenuTrigger>
        {/* In the editor's wrapper (inside the page's landmarks), not at the end of <body>. */}
        <DropdownMenuPortal container={frame}>
          <Menu.Positioner align="end" sideOffset={6} collisionBoundary={frame} collisionPadding={8} className="isolate z-50 outline-none">
            <Menu.Popup
              finalFocus={() => editor.view.dom}
              className="z-50 w-52 origin-(--transform-origin) rounded-xl border border-hairline bg-surface p-1 text-sm text-text shadow-pop outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            >
              {GROUPS.map((group, i) => (
                <Menu.Group key={i}>
                  {i ? <DropdownMenuSeparator className="mx-1 my-1 bg-hairline" /> : null}
                  {group.map(({ command, label, icon: Icon, danger }) => (
                    <DropdownMenuItem
                      key={command}
                      disabled={!editor.can()[command]()}
                      onClick={() => run(command)}
                      className={
                        danger
                          ? "gap-2.5 rounded-lg px-2 py-1.5 text-danger-text focus:bg-danger-soft focus:text-danger-text"
                          : "gap-2.5 rounded-lg px-2 py-1.5 text-text focus:bg-hover"
                      }
                    >
                      <Icon className={danger ? "size-4" : "size-4 text-text-muted"} strokeWidth={1.75} aria-hidden />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </Menu.Group>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  );
}
