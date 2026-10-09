"use client";

import { useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { ChevronDown, History, Redo2, RotateCcw, Undo2, type LucideProps } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative } from "@/components/versions/format";
import { isApple } from "@/editor/lib/platform";
import { getBaseVersion } from "@/server/queries/base-version";
import { SaveIndicator } from "./autosave/save-indicator";
import { useCanRevert, useHistoryControls, useOwnsFields, useSaveStatus, useWorkspaceSession } from "./session/workspace-session";

/** What "Revert to v3" replaces: the draft's versioned content (the name lives on the template, so it stays). */
const VERSION_FIELDS = ["body", "variables", "channels", "emailSubject", "emailPreheader", "sampleSets"] as const;

export interface SaveStatusProps {
  templateId: string;
  /** The number of the version the draft was started from; null when it wasn't started from one. */
  basedOn: number | null;
  /** The number of the Active version, if any. */
  activeNumber: number | null;
}

/**
 * "Saved", "Saving…" or why it didn't save: the autosave status of the draft on screen, with the
 * draft's history controls:
 *   - Undo and redo, always both, from the first paint (the server renders them). Each is greyed out,
 *     with a "Nothing to undo" tooltip, while it has nothing to do and until the editor's history is
 *     ready. They act where ⌘Z would: the field last typed in (the document until another has had focus).
 *   - The status itself opens a small menu when there is something to go back to: "Revert to when you
 *     opened it" once something has changed, and "Revert to v3" on a draft started from v3. Each
 *     toast has an Undo that puts the changes back.
 * Undo and redo come first, so nothing the status does moves them: it changes width as it saves, and
 * gains its menu's chevron once the Content tab is on screen. Before them, either would be a layout shift.
 */
export function SaveStatus({ templateId, basedOn, activeNumber }: SaveStatusProps) {
  const { status, error } = useSaveStatus();
  const canRevert = useCanRevert();
  // The content is on screen to take another version's fields: the Content tab, editable.
  const contentOnScreen = useOwnsFields(VERSION_FIELDS);
  const base = basedOn !== null && contentOnScreen ? { number: basedOn, active: basedOn === activeNumber } : null;
  const indicator = <SaveIndicator status={status} error={error} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <UndoRedo />
      {canRevert || base ? (
        <RevertMenu templateId={templateId} sinceOpened={canRevert} base={base}>
          {indicator}
        </RevertMenu>
      ) : (
        indicator
      )}
    </span>
  );
}

const noSubscribe = () => () => {};

function UndoRedo() {
  const history = useHistoryControls();
  // The server and hydration render the Ctrl shortcuts; an Apple platform's ⌘ ones follow straight after.
  const apple = useSyncExternalStore(noSubscribe, isApple, () => false);
  return (
    <span role="group" aria-label="History" className="inline-flex items-center gap-0.5">
      <HistoryButton
        label="Undo"
        idle="Nothing to undo"
        shortcut={apple ? "⌘Z" : "Ctrl+Z"}
        icon={Undo2}
        enabled={history?.canUndo ?? false}
        onPress={() => history?.undo()}
      />
      <HistoryButton
        label="Redo"
        idle="Nothing to redo"
        shortcut={apple ? "⇧⌘Z" : "Ctrl+Shift+Z"}
        icon={Redo2}
        enabled={history?.canRedo ?? false}
        onPress={() => history?.redo()}
      />
    </span>
  );
}

function HistoryButton({
  label,
  idle,
  shortcut,
  icon: Icon,
  enabled,
  onPress,
}: {
  label: string;
  /** The tooltip while there is nothing to do. */
  idle: string;
  shortcut: string;
  icon: ComponentType<LucideProps>;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-keyshortcuts={shortcut.replace("⌘", "Meta+").replace("⇧", "Shift+").replace("Ctrl", "Control")}
            disabled={!enabled}
            // A keyboard user pressing it to the end keeps their place on it. Focusable, it is marked
            // `data-disabled` (not the native `disabled`), so that is what greys it out below.
            focusableWhenDisabled
            // A click keeps the caret where it is, so the change shows where the author was typing.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPress}
            className="text-text-muted hover:text-text data-disabled:cursor-default data-disabled:text-text-subtle data-disabled:opacity-50 data-disabled:hover:bg-transparent data-disabled:hover:text-text-subtle"
          />
        }
      >
        <Icon aria-hidden strokeWidth={1.75} />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {enabled ? (
          <>
            {label}
            <Kbd>{shortcut}</Kbd>
          </>
        ) : (
          idle
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Undo for a revert's toast, and focus somewhere sensible when the menu went away with the changes. */
function announce(message: string, undo: () => void) {
  toast(message, { action: { label: "Undo", onClick: undo }, duration: 10_000 });
  // Land on the status row, where the outcome reads, rather than the page.
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.querySelector<HTMLElement>('[data-slot="status-row"]')?.focus({ preventScroll: true });
  });
}

/** The status, as the trigger of a small menu: Revert to when you opened it, Revert to v3. */
function RevertMenu({
  templateId,
  sinceOpened,
  base,
  children,
}: {
  templateId: string;
  sinceOpened: boolean;
  base: { number: number; active: boolean } | null;
  children: ReactNode;
}) {
  const session = useWorkspaceSession();
  const [opened, setOpened] = useState("");

  function revert() {
    const previous = session.revert();
    if (previous) announce("Reverted to when you opened it", () => session.restore(previous));
  }

  async function revertToBase() {
    // Only the base version is read from the server: what Undo puts back is what is on screen now.
    const result = await getBaseVersion({ templateId });
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    const { number, ...fields } = result.base;
    const previous = session.replace(fields);
    if (previous) announce(`Reverted to v${number}`, () => session.restore(previous));
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setOpened(formatRelative(new Date(session.getOpenedAt()).toISOString(), new Date()));
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="-mx-1.5 inline-flex h-7 cursor-pointer items-center gap-0.5 rounded-md px-1.5 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-hover"
          />
        }
      >
        {children}
        <ChevronDown aria-hidden strokeWidth={1.75} className="size-3.5 text-text-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-64">
        {sinceOpened ? (
          <DropdownMenuItem onClick={revert} className="items-start gap-2.5 px-2 py-1.5">
            <RotateCcw aria-hidden strokeWidth={1.75} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-[14px] leading-5">Revert to when you opened it</span>
              <span className="text-[12px] leading-4 text-text-muted">Opened {opened}</span>
            </span>
          </DropdownMenuItem>
        ) : null}
        {sinceOpened && base ? <DropdownMenuSeparator /> : null}
        {base ? (
          <DropdownMenuItem onClick={() => void revertToBase()} className="items-start gap-2.5 px-2 py-1.5">
            <History aria-hidden strokeWidth={1.75} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-[14px] leading-5">Revert to v{base.number}</span>
              <span className="text-[12px] leading-4 text-text-muted">
                {base.active ? "The Active version. The draft stays open." : "Where this draft started. It stays open."}
              </span>
            </span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
