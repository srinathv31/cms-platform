"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { consequences } from "@/domain/consequences";
import type { ConsumerUsage, SunsetCalendar } from "@/domain/review-types";
import { setSunset } from "@/server/actions/review";
import { ActionDialog, Consequences, useActionDialog } from "./action-dialog";
import { formatLong } from "./format";
import { SunsetCalendarContent, SunsetZone } from "./sunset-calendar";
import { defaultSunsetDate, validateSunsetDate } from "./validation";

/**
 * Set (or move) the sunset date of a Superseded version. The consequence lines follow the date as
 * it changes, from the render log's usage rows. With no sunset yet it is "Set sunset for vN" and the
 * primary is "Set sunset"; with one, "Change sunset for vN" and "Change sunset". The picker's today is
 * the business time zone's, and the line under it names the zone the day ends in.
 */
export function SunsetDialog({
  open,
  onOpenChange,
  templateId,
  versionNumber,
  currentSunset,
  activeNumber,
  usage,
  calendar,
  nowIso,
  finalFocus,
  onSucceeded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  versionNumber: number;
  /** YYYY-MM-DD of the sunset already set, if any. */
  currentSunset: string | null;
  activeNumber: number | null;
  usage: readonly ConsumerUsage[];
  /** The business time zone and today in it, on the demo clock. */
  calendar: SunsetCalendar;
  /** The demo clock's instant. */
  nowIso: string;
  finalFocus?: () => HTMLElement | null;
  /** The sunset was saved (called before the dialog closes). */
  onSucceeded?: () => void;
}) {
  const { today, zone } = calendar;
  const [ymd, setYmd] = useState(() => defaultSunsetDate(currentSunset, today));
  const [pickerOpen, setPickerOpen] = useState(false);
  const dateButton = useRef<HTMLButtonElement>(null);
  const { pending, error, setError, submit } = useActionDialog(() => {
    onSucceeded?.();
    onOpenChange(false);
  });
  const changing = currentSunset !== null;
  const verb = changing ? "Change sunset" : "Set sunset";

  const invalid = validateSunsetDate(ymd, today);
  const lines = useMemo(
    () =>
      invalid
        ? []
        : consequences({ kind: "sunset", number: versionNumber, sunsetAt: ymd, activeNumber }, usage, new Date(nowIso)),
    [invalid, ymd, versionNumber, activeNumber, usage, nowIso],
  );

  const labelId = `sunset-${versionNumber}-label`;
  const buttonId = `sunset-${versionNumber}-date`;
  const zoneId = `sunset-${versionNumber}-zone`;

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setYmd(defaultSunsetDate(currentSunset, today));
        setError(null);
      }}
      title={`${verb} for v${versionNumber}`}
      description={`Consumers keep rendering v${versionNumber} until the day you choose.`}
      error={error}
      busy={pending}
      initialFocus={dateButton}
      finalFocus={finalFocus}
      primary={{
        label: verb,
        blocked: invalid !== null,
        onClick: () => submit(invalid, () => setSunset({ templateId, versionNumber, sunsetAt: ymd })),
      }}
    >
      <div className="flex flex-col gap-2">
        <Label id={labelId} className="caps-label">
          Sunset date
        </Label>
        <Popover open={pickerOpen} onOpenChange={(next) => !pending && setPickerOpen(next)}>
          <PopoverTrigger
            ref={dateButton}
            id={buttonId}
            aria-labelledby={`${labelId} ${buttonId}`}
            aria-describedby={zoneId}
            render={<Button variant="outline" className="h-8 w-56 justify-start gap-2 bg-surface px-2.5 font-normal text-text" />}
          >
            <CalendarDays aria-hidden strokeWidth={1.75} className="text-text-muted" />
            {formatLong(ymd) || "Pick a date"}
          </PopoverTrigger>
          <SunsetCalendarContent
            ymd={ymd}
            today={today}
            onPick={(next) => {
              setYmd(next);
              setError(null);
              setPickerOpen(false);
            }}
          />
        </Popover>
        <SunsetZone id={zoneId} zone={zone} />
      </div>
      {lines.length > 0 ? <Consequences lines={lines} /> : null}
    </ActionDialog>
  );
}
