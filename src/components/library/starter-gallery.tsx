"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { m } from "motion/react";
import { fadeRise } from "@/components/motion/presets";
import { Segmented, type SegmentedOption } from "@/components/primitives/segmented";
import { useActionRun } from "@/components/primitives/use-action-run";
import { Spinner } from "@/components/ui/spinner";
import { importUnavailable } from "@/domain/import-types";
import { CHANNEL_FAMILIES, TEMPLATE_KIND_LABELS, type ChannelFamily } from "@/domain/types";
import { createTemplate } from "@/server/actions/create-template";
import { STARTERS, type StarterChoice } from "@/server/starters/catalog";
import { cn } from "@/lib/utils";
import { ImportRow } from "./import-row";
import { StarterPreview } from "./starter-preview";

/** Document · Alert: which kind of template, and so its content type for life (decision 0033). */
const KINDS: readonly SegmentedOption<ChannelFamily>[] = CHANNEL_FAMILIES.map((family) => ({
  value: family,
  label: TEMPLATE_KIND_LABELS[family],
}));

const sameChoice = (a: StarterChoice | null, b: StarterChoice) => a?.family === b.family && a.starterKey === b.starterKey;

/**
 * The starting points. Over them, Document · Alert chooses the kind of template: a document renders one
 * body to PDF, Web and Email, an alert its own push and text message, and a template stays the kind it
 * was made as. Each kind has its own starters, Blank first; Document is chosen when the gallery opens, so
 * a document is still two clicks from the Library. Picking a card creates the template and opens it.
 * Under the cards, the dashed "Import a file" row makes a document from a .docx, .pdf or .txt instead;
 * with Alert chosen it stays in place, disabled, with its reason. Used in the New template dialog and,
 * inline, as the empty state of a team's Library. One thing happens at a time: while a card is creating
 * or a file is importing, the rest (the kind too) are locked. A refusal shows its sentence under the cards.
 *
 * `onImported` is called when the new template has opened, from a card as from a file.
 *
 * Keyboard: Tab moves across the cards, and so do the arrow keys (Home and End jump to the ends).
 * Enter or Space picks.
 */
export function StarterGallery({
  teamSlug,
  columns,
  firstCardRef,
  importRowRef,
  onBusyChange,
  onImported,
}: {
  teamSlug: string;
  /** How many cards sit in a row. It sets the layout and what the up and down arrows mean. */
  columns: 2 | 4;
  /** The dialog focuses the first card when it opens. */
  firstCardRef?: Ref<HTMLButtonElement>;
  /** The dialog focuses the Import row when it was opened for Import (the ⌘K palette). */
  importRowRef?: Ref<HTMLButtonElement>;
  /** True from the pick (or the file) until the new template opens. The dialog uses it to stay open. */
  onBusyChange?: (busy: boolean) => void;
  /** A template was made (from a card or a file) and has opened: the dialog closes along with that navigation. */
  onImported?: () => void;
}) {
  const { pending, error, setError, run } = useActionRun("Couldn't create the template. Try again.");
  const [family, setFamily] = useState<ChannelFamily>("document");
  const [picked, setPicked] = useState<StarterChoice | null>(null);
  const [importing, setImporting] = useState(false);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const busy = pending || importing;
  const starters = STARTERS[family];

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // The new template has opened (the creation's navigation is done): let the dialog close, so it
  // isn't left open behind the template, in the Library that stays mounted but hidden.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && picked !== null) {
      setPicked(null);
      onImported?.();
    }
    wasPending.current = pending;
  }, [pending, picked, onImported]);

  const onImportBusy = useCallback((next: boolean) => setImporting(next), []);

  function choose(next: ChannelFamily) {
    if (busy) return;
    setFamily(next);
    // A refusal was about the other kind's cards.
    setError(null);
  }

  function pick(choice: StarterChoice) {
    if (busy) return;
    // On success the action redirects, and Next follows it (`runAction` hands the redirect back).
    if (run(() => createTemplate({ teamSlug, ...choice }), { onRefused: () => setPicked(null) })) setPicked(choice);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = starters.length - 1;
    const next = {
      ArrowRight: Math.min(index + 1, last),
      ArrowLeft: Math.max(index - 1, 0),
      ArrowDown: index + columns <= last ? index + columns : index,
      ArrowUp: index - columns >= 0 ? index - columns : index,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    cards.current[next]?.focus();
  }

  return (
    <div>
      <Segmented label="Kind of template" value={family} options={KINDS} onChange={choose} disabled={busy} className="mb-5" />
      {/* Keyed by the kind: the cards fade in when it changes, and a card's ref and focus belong to its kind. */}
      <m.div
        key={family}
        {...fadeRise}
        role="group"
        aria-label="Starting points"
        className={cn("grid gap-4", columns === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}
      >
        {starters.map((starter, index) => {
          const choice = { family, starterKey: starter.key } as StarterChoice;
          const isPicked = sameChoice(picked, choice);
          const id = `starter-${family}-${starter.key}-description`;
          return (
            <button
              key={starter.key}
              type="button"
              ref={(el) => {
                cards.current[index] = el;
                if (index === 0 && firstCardRef) {
                  if (typeof firstCardRef === "function") firstCardRef(el);
                  else (firstCardRef as { current: HTMLButtonElement | null }).current = el;
                }
              }}
              aria-describedby={id}
              aria-disabled={busy && !isPicked ? true : undefined}
              aria-busy={isPicked && pending ? true : undefined}
              onClick={() => pick(choice)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "group/card flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-2.5 text-left outline-none transition-colors",
                "hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                isPicked && "bg-selected",
                busy && !isPicked && "opacity-50",
                busy && "cursor-default",
              )}
            >
              <span className="relative block">
                <StarterPreview
                  starter={choice}
                  className={cn(columns === 2 ? "h-36" : "h-44", "transition-opacity", isPicked && pending && "opacity-60")}
                />
                {isPicked && pending ? (
                  <span className="absolute inset-0 grid place-items-center">
                    <Spinner aria-label={`Creating ${starter.name}`} className="size-5 text-text-muted" />
                  </span>
                ) : null}
              </span>
              <span className="block px-1.5 pb-1">
                <span className="block text-[15px] leading-5 font-medium text-text">{starter.name}</span>
                <span id={id} className="mt-0.5 block text-[13px] leading-[18px] text-text-muted">
                  {starter.description}
                </span>
              </span>
            </button>
          );
        })}
      </m.div>
      <div className="mt-4">
        <ImportRow
          teamSlug={teamSlug}
          locked={pending}
          unavailable={importUnavailable(family)}
          onBusyChange={onImportBusy}
          onImported={onImported}
          rowRef={importRowRef}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-[13px] text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
