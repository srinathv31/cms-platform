"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type Ref } from "react";
import { unstable_rethrow } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { createTemplate } from "@/server/actions/templates";
import { STARTERS, type StarterKey } from "@/server/starters/catalog";
import { cn } from "@/lib/utils";
import { StarterPreview } from "./starter-preview";

/**
 * The starting points: Blank first, then the examples. Picking one creates the template and opens it,
 * so choosing a card is the second click from the Library. Used in the New template dialog and,
 * inline, as the empty state of a team's Library.
 *
 * Keyboard: Tab moves across the cards, and so do the arrow keys (Home and End jump to the ends).
 * Enter or Space picks.
 */
export function StarterGallery({
  teamSlug,
  columns,
  firstCardRef,
  onBusyChange,
}: {
  teamSlug: string;
  /** How many cards sit in a row. It sets the layout and what the up and down arrows mean. */
  columns: 2 | 4;
  /** The dialog focuses the first card when it opens. */
  firstCardRef?: Ref<HTMLButtonElement>;
  /** True from the pick until the new template opens. The dialog uses it to stay open. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<StarterKey | null>(null);
  const [failed, setFailed] = useState(false);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    onBusyChange?.(pending);
  }, [pending, onBusyChange]);

  function pick(starterKey: StarterKey) {
    if (pending) return;
    setPicked(starterKey);
    setFailed(false);
    startTransition(async () => {
      try {
        // On success the action redirects, which reaches here as an error Next handles itself.
        await createTemplate({ teamSlug, starterKey });
      } catch (error) {
        unstable_rethrow(error);
        setPicked(null);
        setFailed(true);
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = STARTERS.length - 1;
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
      <div
        role="group"
        aria-label="Starting points"
        className={cn("grid gap-4", columns === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4")}
      >
        {STARTERS.map((starter, index) => {
          const isPicked = picked === starter.key;
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
              aria-describedby={`starter-${starter.key}-description`}
              aria-disabled={pending && !isPicked ? true : undefined}
              aria-busy={isPicked && pending ? true : undefined}
              onClick={() => pick(starter.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "group/card flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-2.5 text-left outline-none transition-colors",
                "hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                isPicked && "bg-selected",
                pending && !isPicked && "opacity-50",
                pending && "cursor-default",
              )}
            >
              <span className="relative block">
                <StarterPreview
                  starter={starter.key}
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
                <span
                  id={`starter-${starter.key}-description`}
                  className="mt-0.5 block text-[13px] leading-[18px] text-text-muted"
                >
                  {starter.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {failed ? (
        <p role="alert" className="mt-4 text-[13px] text-danger-text">
          Couldn&apos;t create the template. Try again.
        </p>
      ) : null}
    </div>
  );
}
