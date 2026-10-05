"use client";

// The sample-set switcher: one compact trigger showing the current set's name. Its menu lists the
// sets (a radio), then Edit values… and New sample set. Edit values… opens a popover under the
// trigger with the values editor. The host owns the data: it passes the sets in (from `listSets`)
// and gets the next list back through `onChange` after every stored edit.

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { ChevronDown, Eye, Pencil, Plus } from "lucide-react";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import type { SampleSet, Variable } from "@/editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PopoverTitle } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { addSet, createSet, findSet, removeSet } from "./model";
import { AUTOFOCUS_ATTR, ValuesEditor } from "./values-editor";

export interface SampleSetSwitcherHandle {
  /** Opens the values editor (the preview's error state has an "Edit values" button). */
  openEditor(): void;
}

export interface SampleSetSwitcherProps {
  /** As returned by `listSets`. */
  sets: SampleSet[];
  variables: readonly Variable[];
  /** YYYY-MM-DD, the demo clock. */
  today: string;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Values edited, a set added, renamed or removed. Leave it out for a read-only switcher. */
  onChange?: (sets: SampleSet[]) => void;
  /** Switching works; the values show as text and there's no New sample set. */
  readOnly?: boolean;
  ref?: Ref<SampleSetSwitcherHandle>;
  className?: string;
}

export function SampleSetSwitcher({
  sets,
  variables,
  today,
  selectedId,
  onSelect,
  onChange,
  readOnly = false,
  ref,
  className,
}: SampleSetSwitcherProps) {
  const editable = !readOnly && onChange !== undefined;
  const current = findSet(sets, selectedId) ?? sets[0];

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [focusName, setFocusName] = useState(false);
  // The editor opens once the menu has finished closing, so the menu's focus return to the
  // trigger can't take focus back from the editor.
  const openAfterMenu = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      openEditor() {
        setFocusName(false);
        setEditorOpen(true);
      },
    }),
    [],
  );

  const changeEditorOpen = (open: boolean) => {
    setEditorOpen(open);
    if (!open) setFocusName(false);
  };

  const addNew = () => {
    if (!onChange || !current) return;
    const made = createSet(sets, current, variables, today);
    onChange(addSet(sets, made));
    onSelect(made.id);
    setFocusName(true);
    openAfterMenu.current = true;
  };

  const deleteCurrent = () => {
    if (!onChange || !current) return;
    const index = sets.findIndex((set) => set.id === current.id);
    const next = removeSet(sets, current.id);
    const landing = sets[Math.max(0, index - 1)];
    if (landing && landing.id !== current.id) onSelect(landing.id);
    onChange(next);
    changeEditorOpen(false);
  };

  if (!current) return null;

  const EditIcon = editable ? Pencil : Eye;

  return (
    <>
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (open || !openAfterMenu.current) return;
          openAfterMenu.current = false;
          setEditorOpen(true);
        }}
      >
        <DropdownMenuTrigger
          aria-label={`Sample set: ${current.name}`}
          render={
            <Button
              ref={triggerRef}
              variant="outline"
              title={current.name}
              // 32px tall like every control in the rail, so the header row never changes height. The
              // button is as wide as the name needs; a name wider than the room it is given (a long
              // custom name, a narrow overlay) is cut short with an ellipsis, and `title` has it whole.
              className={cn("max-w-full min-w-0 justify-between gap-2 bg-surface px-2.5 text-[13px] font-normal", className)}
            />
          }
        >
          <span className="min-w-0 truncate text-left">{current.name}</span>
          <ChevronDown data-icon="inline-end" strokeWidth={1.75} className="text-text-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 shadow-pop">
          <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => onSelect(String(id))}>
            {sets.map((set) => (
              <DropdownMenuRadioItem key={set.id} value={set.id} closeOnClick>
                {set.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setFocusName(false);
              openAfterMenu.current = true;
            }}
          >
            <EditIcon strokeWidth={1.75} />
            {editable ? "Edit values…" : "View values…"}
          </DropdownMenuItem>
          {editable ? (
            <DropdownMenuItem onClick={addNew}>
              <Plus strokeWidth={1.75} />
              New sample set
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <PopoverPrimitive.Root open={editorOpen} onOpenChange={changeEditorOpen}>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner
            anchor={triggerRef}
            side="bottom"
            align="start"
            sideOffset={4}
            // Under the trigger (or over it when there's more room there); never beside it. A long list scrolls.
            collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
            className="isolate z-50"
          >
            <PopoverPrimitive.Popup
              ref={popupRef}
              data-slot="sample-set-editor"
              initialFocus={() => popupRef.current?.querySelector<HTMLElement>(`[${AUTOFOCUS_ATTR}]`) ?? true}
              finalFocus={triggerRef}
              className="z-50 flex max-h-(--available-height) w-[min(26rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground shadow-pop ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
            >
              <PopoverTitle className="sr-only">{`${current.name}: ${editable ? "edit values" : "values"}`}</PopoverTitle>
              <ValuesEditor
                key={current.id}
                set={current}
                sets={sets}
                variables={variables}
                today={today}
                editable={editable}
                focusName={focusName}
                onChange={(next) => onChange?.(next)}
                onDelete={deleteCurrent}
              />
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  );
}
