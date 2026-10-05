"use client";

import { useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { NAV_ICON_STROKE } from "@/components/app-shell/nav";
import { BASELINE, TODAY, VERSION, addDays, approveConsequences, formatShort } from "./fixtures";
import type { StageCount } from "./types";

/*
 * The two decision dialogs. Both are the app's centered dialog on the flat scrim (`ScrimDialogContent`,
 * 22px corners, the modal shadow), one primary button each, Cancel beside it as an outline.
 */

const SIZE = "rounded-3xl p-8";

function CloseX() {
  return (
    <DialogClose
      render={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close"
          className="absolute top-5 right-5 size-9 rounded-full text-text-muted hover:bg-hover hover:text-text"
        />
      }
    >
      <X aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
    </DialogClose>
  );
}

/** "adds required `annual_fee`" → the key in Geist Mono. */
function Line({ text }: { text: string }) {
  return (
    <p className="text-[14px] leading-6 text-text">
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded-md bg-surface px-1 py-px font-mono text-[12.5px]">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

// "YYYY-MM-DD" ⇄ the local Date the calendar works with.
const toLocal = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toYmd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// ── Approve ──────────────────────────────────────────────────────

export function ApproveDialog({
  open,
  onOpenChange,
  stages,
  final,
  initialSunset,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: StageCount;
  /** This approval completes the chain: the version goes live, so the previous one can be sunset. */
  final: boolean;
  initialSunset: string | null;
  onConfirm: (sunset: string | null) => void;
}) {
  const [sunset, setSunset] = useState<string | null>(initialSunset);
  const [on, setOn] = useState(initialSunset !== null);
  const [picking, setPicking] = useState(false);
  // Each opening starts from the same place.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSunset(initialSunset);
      setOn(initialSunset !== null);
      setPicking(false);
    }
  }

  const effective = final && on ? sunset : null;
  const lines = approveConsequences({ stages, final, sunset: effective });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ScrimDialogContent className={`w-[min(31rem,calc(100vw-2rem))] ${SIZE}`}>
        <DialogTitle className="display-lg">Approve v{VERSION}</DialogTitle>

        <div data-consequences="" className="mt-5 flex flex-col gap-2 rounded-xl border border-hairline bg-surface-tinted px-4 py-3.5">
          {lines.map((line) => (
            <Line key={line} text={line} />
          ))}
        </div>

        {final ? (
          <div className="mt-5 flex h-8 items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-text">
              <Checkbox
                checked={on}
                onCheckedChange={(next) => {
                  setOn(next);
                  if (next && !sunset) setSunset(addDays(TODAY, 14));
                }}
              />
              Set a sunset date for v{BASELINE}
            </label>
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger
                render={<Button variant="outline" disabled={!on} aria-label="Sunset date" className="gap-1.5 bg-surface px-3 text-[13px]" />}
              >
                <CalendarDays data-icon="inline-start" strokeWidth={1.75} />
                {on && sunset ? formatShort(sunset) : "Pick a date"}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto rounded-xl p-0">
                <Calendar
                  mode="single"
                  selected={sunset ? toLocal(sunset) : undefined}
                  defaultMonth={sunset ? toLocal(sunset) : toLocal(addDays(TODAY, 14))}
                  disabled={{ before: toLocal(addDays(TODAY, 1)) }}
                  onSelect={(date) => {
                    if (date) setSunset(toYmd(date));
                    setPicking(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        ) : null}

        <div className="mt-7 flex justify-end gap-2">
          <DialogClose render={<Button variant="outline" className="bg-surface" />}>Cancel</DialogClose>
          <Button onClick={() => onConfirm(effective)}>Approve v{VERSION}</Button>
        </div>
        <CloseX />
      </ScrimDialogContent>
    </Dialog>
  );
}

// ── Request changes ──────────────────────────────────────────────

export function RequestDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason("");
  }
  const ready = reason.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ScrimDialogContent initialFocus={field} className={`w-[min(29rem,calc(100vw-2rem))] ${SIZE}`}>
        <DialogTitle className="display-lg">Request changes</DialogTitle>
        <label htmlFor="request-reason" className="mt-5 block text-[14px] font-medium text-text">
          Reason
        </label>
        <Textarea
          id="request-reason"
          ref={field}
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-2 min-h-28 bg-surface text-[14px]"
        />
        <div className="mt-6 flex justify-end gap-2">
          <DialogClose render={<Button variant="outline" className="bg-surface" />}>Cancel</DialogClose>
          <Button disabled={!ready} onClick={() => onConfirm(reason.trim())}>
            Request changes
          </Button>
        </div>
        <CloseX />
      </ScrimDialogContent>
    </Dialog>
  );
}

