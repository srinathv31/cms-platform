"use client";

import { useRef, useState, useSyncExternalStore, useTransition, type ComponentType, type ReactNode } from "react";
import { ChevronDown, History, Redo2, RotateCcw, RotateCw, Undo2, type LucideProps } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { runAction } from "@/components/versions/action-dialog";
import { formatRelative } from "@/components/versions/format";
import { isApple } from "@/editor/lib/platform";
import { readTemplate } from "@/lib/template-reads";
import type { BaseVersionContent } from "@/server/queries/base-version";
import type { SaveFields } from "./autosave/autosave-scheduler";
import { SaveIndicator } from "./autosave/save-indicator";
import type { WorkspaceSession } from "./session/session-store";
import { useCanRevert, useHistoryControls, useInert, useOwnsFields, useSaveStatus, useWorkspaceSession } from "./session/workspace-session";

/** What "Revert to v3" replaces: every versioned field of the draft, its name included. */
const VERSION_FIELDS = ["name", "body", "variables", "channels", "emailSubject", "emailPreheader", "sampleSets"] as const;

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
 *     toast has an Undo that puts the changes back, until anything else is edited or the content
 *     leaves the screen: then the toast goes, so Undo never drops a newer edit.
 * Once saving has stopped for good, the status reads "Not saved." and `SaveStopped`, on its own line
 * under it, says why and offers Reload.
 * Undo and redo come first, so nothing the status does moves them: it changes width as it saves, and
 * gains its menu's chevron once the Content tab is on screen. Before them, either would be a layout shift.
 */
export function SaveStatus({ templateId, basedOn, activeNumber }: SaveStatusProps) {
  const { status, error, stopped } = useSaveStatus();
  const canRevert = useCanRevert();
  // The content is on screen to take another version's fields: the Content tab, editable.
  const contentOnScreen = useOwnsFields(VERSION_FIELDS);
  const base = basedOn !== null && contentOnScreen ? { number: basedOn, active: basedOn === activeNumber } : null;
  // Stopped, the reason is SaveStopped's: it needs more room than the status row has.
  const indicator = <SaveIndicator status={status} error={stopped ? undefined : error} />;
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

/**
 * Saving has stopped for good (the draft changed in another tab, or can't be edited any more): why,
 * in a sentence that says plainly that the latest changes can't be saved, and Reload. The page is
 * held read-only meanwhile (the session's inert hold), so nothing more is typed that would be
 * dropped, and what is on screen can still be selected and copied. Reload shows the draft as it now
 * is; the browser asks first, since the page still holds what wasn't saved (use-draft-autosave.ts).
 *
 * The header renders it on a line of its own under the status row, the full width of the header (the
 * status row shares its line with the Template ID), so the sentence and its button fit on one line
 * from 1000px up. It renders nothing until saving stops.
 */
export function SaveStopped({ className }: { className?: string }) {
  const { error, stopped } = useSaveStatus();
  if (!stopped) return null;
  return (
    <div data-slot="save-stopped" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <p role="alert" className="text-[13px] leading-5 text-danger-text">
        {error}
      </p>
      {/* A secondary action: the tab bar keeps the one black button. */}
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        <RotateCw data-icon="inline-start" aria-hidden strokeWidth={1.75} />
        Reload
      </Button>
    </div>
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

/**
 * A revert's toast, with an Undo that puts the changes back, and focus somewhere sensible when the
 * menu went away with the changes.
 *
 * Undo is offered only while it is safe (`session.canRestore`): the toast goes as soon as anything
 * else is edited, or a field it would put back leaves the screen (another tab). Putting the old
 * values back then would drop the newer edit, or save content the hidden tab doesn't show.
 */
function offerUndo(session: WorkspaceSession, message: string, previous: SaveFields) {
  const since = session.getEditGeneration();
  let stop = () => {};
  const id = toast(message, {
    action: {
      label: "Undo",
      onClick: () => {
        stop();
        session.restore(previous, since);
      },
    },
    duration: 10_000,
    onDismiss: () => stop(),
    onAutoClose: () => stop(),
  });
  stop = session.subscribe(() => {
    if (session.canRestore(previous, since)) return;
    stop();
    toast.dismiss(id);
  });
  // Land on the status row, where the outcome reads, rather than the page.
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    session.focusTargets.get("statusRow")?.focus({ preventScroll: true });
  });
}

/**
 * The status, as the trigger of a small menu: Revert to when you opened it, Revert to v3.
 * "Revert to v3" reads the version from the server (GET /api/templates/[templateId]/base-version).
 * While it does, the menu stays open with both items greyed out and "Reverting…" under the one
 * pressed, so a second press can't start another; a failure shows in a toast. Both are greyed out too
 * while the session is inert (Submit is reading the saved draft), when a revert would be refused.
 */
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
  const inert = useInert();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState("");
  const [pending, start] = useTransition();
  const reading = useRef(false);

  function revert() {
    const previous = session.revert();
    if (previous) offerUndo(session, "Reverted to when you opened it", previous);
  }

  function revertToBase() {
    // The base of the draft on screen, not of whichever draft the template has by the time this lands.
    const versionId = session.getBinding()?.versionId;
    if (reading.current || !versionId) return;
    reading.current = true;
    start(async () => {
      try {
        const result = await runAction(() =>
          readTemplate<{ base: BaseVersionContent }>(templateId, "base-version", { draft: versionId }),
        );
        setOpen(false);
        if (!result.ok) {
          toast.error(result.reason);
          return;
        }
        // Only the base version is read from the server: what Undo puts back is what is on screen now.
        const { number, ...fields } = result.base;
        const previous = session.replace(fields);
        if (previous) offerUndo(session, `Reverted to v${number}`, previous);
      } finally {
        reading.current = false;
      }
    });
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) setOpened(formatRelative(new Date(session.getOpenedAt()).toISOString(), new Date()));
        setOpen(next);
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
          <DropdownMenuItem onClick={revert} disabled={pending || inert} className="items-start gap-2.5 px-2 py-1.5">
            <RotateCcw aria-hidden strokeWidth={1.75} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-[14px] leading-5">Revert to when you opened it</span>
              <span className="text-[12px] leading-4 text-text-muted">Opened {opened}</span>
            </span>
          </DropdownMenuItem>
        ) : null}
        {sinceOpened && base ? <DropdownMenuSeparator /> : null}
        {base ? (
          <DropdownMenuItem
            onClick={revertToBase}
            // It closes once the version has arrived (or failed), so its greyed "Reverting…" shows meanwhile.
            closeOnClick={false}
            disabled={pending || inert}
            aria-busy={pending || undefined}
            className="items-start gap-2.5 px-2 py-1.5"
          >
            <History aria-hidden strokeWidth={1.75} className="mt-0.5" />
            <span className="flex flex-col">
              <span className="text-[14px] leading-5">Revert to v{base.number}</span>
              {/* Both lines hold the cell, so the menu keeps its width as one replaces the other. */}
              <span className="grid text-[12px] leading-4 text-text-muted">
                <span className={cn("col-start-1 row-start-1", pending && "invisible")}>
                  {base.active ? "The Active version. The draft stays open." : "Where this draft started. It stays open."}
                </span>
                <span className={cn("col-start-1 row-start-1", !pending && "invisible")}>Reverting…</span>
              </span>
            </span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
