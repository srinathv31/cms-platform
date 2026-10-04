"use client";

// What a chip stands for: label, key, type, sample value and where the variable is used.
// One popover per field, anchored to the open chip; it never takes focus from the document
// (arrows, Backspace and typing keep working on the selected chip). Informational only.
//
// Built on Base UI's Popover parts directly: the chip lives inside contenteditable, so it can't be a
// Popover.Trigger (a focusable button), and shadcn's PopoverContent doesn't pass `anchor` through.

import { Popover } from "@base-ui/react/popover";
import type { Editor } from "@tiptap/react";
import { TriangleAlert } from "lucide-react";
import { useCallback } from "react";
import { useStore } from "zustand";
import { NODE } from "../model/types";
import { TYPE_META, formatValue } from "../model/variables";
import type { ChipPopoverStore } from "../state/chip-popover";
import type { EditorRootRuntime } from "../state/editor-root";
import type { VariablePlace } from "../model/usage";
import { TYPE_ICONS } from "./type-icon";

const POPUP =
  "w-64 origin-(--transform-origin) rounded-xl border border-hairline bg-surface p-3.5 text-sm text-text shadow-pop outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

interface ChipPopoverProps {
  editor: Editor;
  root: EditorRootRuntime;
  chip: ChipPopoverStore;
}

export function ChipPopover(props: ChipPopoverProps) {
  const pos = useStore(props.chip, (s) => s.pos);
  if (pos === null || props.editor.isDestroyed) return null;
  return <ChipPopoverPanel key={pos} pos={pos} {...props} />;
}

function ChipPopoverPanel({ editor, root, chip, pos }: ChipPopoverProps & { pos: number }) {
  const node = editor.state.doc.nodeAt(pos);
  const key = node?.type.name === NODE.variable ? ((node.attrs.key as string | null) ?? null) : null;
  const anchor = editor.isDestroyed ? null : (editor.view.nodeDOM(pos) as HTMLElement | null);
  const variable = useStore(root.variables, (s) => (key ? s.byKey.get(key) : undefined));
  const usage = useStore(root.usage, (s) => (key ? s.byKey.get(key) : undefined));
  const setPopup = useCallback((element: HTMLElement | null) => chip.getState().setElement(element), [chip]);

  if (!key || !anchor) return null;

  const onOpenChange = (open: boolean, details: { event?: Event }) => {
    if (open) return;
    // A press on the chip itself re-opens it right away; don't flicker.
    const target = details.event?.target;
    if (target instanceof Node && anchor.contains(target)) return;
    chip.getState().close();
  };

  const Icon = variable ? TYPE_ICONS[variable.type] : TriangleAlert;

  return (
    <Popover.Root open onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          // Stays within the editor's column (not over a side rail).
          collisionBoundary={anchor.closest(".ucomp-editor, .ucomp-field") ?? "clipping-ancestors"}
          className="isolate z-50"
        >
          <Popover.Popup ref={setPopup} initialFocus={false} finalFocus={false} className={POPUP}>
            <div className="flex items-start gap-3">
              <span
                className={
                  variable
                    ? "flex size-8 shrink-0 items-center justify-center rounded-lg border border-chip-border bg-chip text-chip-icon"
                    : "flex size-8 shrink-0 items-center justify-center rounded-lg border border-warning-border bg-warning-soft text-warning"
                }
              >
                <Icon className="size-4" {...ICON} />
              </span>
              <div className="min-w-0 pt-px">
                {variable ? (
                  <>
                    <Popover.Title className="truncate text-sm font-medium text-text">{variable.label}</Popover.Title>
                    <p className="truncate font-mono text-xs text-text-muted">{key}</p>
                  </>
                ) : (
                  <>
                    <Popover.Title className="truncate font-mono text-sm text-text">{key}</Popover.Title>
                    <Popover.Description className="text-xs text-warning-text">Not in the variable list</Popover.Description>
                  </>
                )}
              </div>
            </div>

            {variable ? (
              <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] leading-5">
                <dt className="text-text-muted">Type</dt>
                <dd className="min-w-0 truncate">
                  {TYPE_META[variable.type].label}
                  <span className="text-text-muted"> · {variable.required ? "Required" : "Optional"}</span>
                </dd>
                <dt className="text-text-muted">Sample</dt>
                <dd className="min-w-0 truncate">{variable.sample ? formatValue(variable.type, variable.sample) : "—"}</dd>
              </dl>
            ) : null}

            {usage && usage.places.length ? <Places places={usage.places} /> : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Places({ places }: { places: readonly VariablePlace[] }) {
  return (
    <div className="mt-3.5 border-t border-hairline pt-3">
      <p className="caps-label">Used in</p>
      <ul className="mt-1.5 grid gap-1 text-[13px] leading-5">
        {places.map((place, i) => (
          <li key={`${place.field}-${place.section ?? ""}-${i}`} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate">{place.section ?? place.field}</span>
            <span className="shrink-0 text-text-muted tabular-nums">{place.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
