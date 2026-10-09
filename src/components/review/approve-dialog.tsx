"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { ActionDialog, useActionDialog } from "@/components/versions/action-dialog";
import { formatLong } from "@/components/versions/format";
import { SunsetCalendarContent, SunsetZone } from "@/components/versions/sunset-calendar";
import { defaultSunsetDate, validateSunsetDate } from "@/components/versions/validation";
import type { ConsumerUsage, SunsetCalendar } from "@/domain/review-types";
import type { ContractChange } from "@/domain/types";
import { approveVersion } from "@/server/actions/review";
import { approveLines, type ApprovalStageInfo } from "./decision-model";
import { WithKeys } from "./rail-sections";

export interface Approved {
  wentLive: boolean;
}

/**
 * The consequence lines after the first (the first is the dialog's description), in the tinted box the
 * action dialogs share (versions/action-dialog.tsx `Consequences`), with the keys in Geist Mono.
 */
function ConsequenceList({ lines }: { lines: readonly string[] }) {
  return (
    <ul data-slot="consequences" className="flex flex-col gap-2 rounded-xl bg-surface-tinted px-4 py-3.5 text-[14px] leading-[1.55] text-text">
      {lines.map((line) => (
        <li key={line}>
          <WithKeys text={line} surface="bg-surface" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Approve the stage the version waits on. It says what will happen before it does: the consequence
 * lines (the domain's `consequences`, from the render log) follow the sunset date as it changes. The
 * first is the dialog's description ("v3 becomes Active. v2 becomes Superseded."), the rest sit in the
 * box under it, among them what a breaking change asks of each consumer ("Coral has to map `annual_fee`
 * before it moves to v3.").
 * Only the last stage makes the version Active, so only then is there a previous version to sunset;
 * an earlier stage just moves the version along. Primary: "Approve vN". A refusal from the server
 * shows at the button; the dialog closes only on success.
 *
 * The date picker is the Versions tab's sunset dialog's (versions/sunset-calendar.tsx): the same
 * calendar, the same earliest day in the business time zone, the same default (30 days out), and the same
 * line naming the zone the day ends in.
 */
export function ApproveDialog({
  open,
  onOpenChange,
  templateId,
  versionNumber,
  previousNumber,
  contractChanges,
  stage,
  usage,
  sunsetCalendar,
  nowIso,
  sampleSetsSeen,
  onBegin,
  onApproved,
  onFailed,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  versionNumber: number;
  /** The Active version this one will replace; null when nothing is Active yet. */
  previousNumber: number | null;
  /** The version's contract changes: the breaking ones are what the consumers have to map. */
  contractChanges: readonly ContractChange[];
  stage: ApprovalStageInfo;
  usage: readonly ConsumerUsage[];
  /** The business time zone and today in it, on the demo clock: the sunset picker's calendar. */
  sunsetCalendar: SunsetCalendar;
  /** The demo clock's instant. */
  nowIso: string;
  /** The sample sets the approver looked at in Preview; the approval records them. */
  sampleSetsSeen: readonly string[];
  /** The request is about to be sent. */
  onBegin?: () => void;
  /** The approval went through (called before the dialog closes). */
  onApproved: (result: Approved) => void;
  /** The server refused it, or couldn't be reached. */
  onFailed?: () => void;
  finalFocus?: () => HTMLElement | null;
}) {
  const { today, zone } = sunsetCalendar;
  const [on, setOn] = useState(false);
  const [ymd, setYmd] = useState(() => defaultSunsetDate(null, today));
  const [pickerOpen, setPickerOpen] = useState(false);
  const check = useRef<HTMLButtonElement>(null);
  const { pending, error, setError, submit } = useActionDialog(() => onOpenChange(false));

  // A sunset date applies to the previous version, when this approval is what makes this one Active.
  const canSunset = stage.final && previousNumber !== null;
  const sunset = canSunset && on ? ymd : null;
  const invalid = sunset ? validateSunsetDate(sunset, today) : null;

  const lines = useMemo(
    () => approveLines({ versionNumber, previousNumber, stage, sunset: invalid ? null : sunset, contractChanges, usage, nowIso }),
    [versionNumber, previousNumber, stage, sunset, invalid, contractChanges, usage, nowIso],
  );
  // What happens is the description; what follows from it (who is affected) is the box.
  const [lead = "", ...rest] = lines;

  const labelId = `approve-${versionNumber}-sunset`;
  const zoneId = `approve-${versionNumber}-sunset-zone`;

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setOn(false);
        setYmd(defaultSunsetDate(null, today));
        setPickerOpen(false);
        setError(null);
      }}
      title={`Approve v${versionNumber}`}
      description={lead}
      error={error}
      busy={pending}
      // The first thing to answer is the sunset question; with none, the safe action.
      initialFocus={canSunset ? check : undefined}
      focusCancel={!canSunset}
      finalFocus={finalFocus}
      primary={{
        label: `Approve v${versionNumber}`,
        blocked: invalid !== null,
        onClick: () =>
          submit(invalid, async () => {
            onBegin?.();
            let ok = false;
            try {
              const result = await approveVersion({
                templateId,
                versionNumber,
                sunsetPrevious: sunset,
                sampleSetsSeen: [...sampleSetsSeen],
              });
              ok = result.ok;
              if (result.ok) onApproved({ wentLive: result.wentLive });
              return result;
            } finally {
              if (!ok) onFailed?.();
            }
          }),
      }}
    >
      {rest.length > 0 || canSunset ? (
        <>
          {rest.length > 0 ? <ConsequenceList lines={rest} /> : null}
          {canSunset ? (
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex h-8 w-full items-center justify-between gap-3">
                <label id={labelId} className="flex cursor-pointer items-center gap-2.5 text-[14px] text-text">
                  <Checkbox
                    ref={check}
                    checked={on}
                    readOnly={pending}
                    onCheckedChange={(next) => {
                      setOn(next);
                      setError(null);
                    }}
                  />
                  Set a sunset date for v{previousNumber}
                </label>
                <Popover open={pickerOpen} onOpenChange={(next) => !pending && setPickerOpen(next)}>
                  <PopoverTrigger
                    aria-label={on && ymd ? `Sunset date, ${formatLong(ymd)}` : "Sunset date"}
                    aria-describedby={zoneId}
                    render={
                      <Button
                        variant="outline"
                        disabled={!on}
                        className="h-8 min-w-44 justify-start gap-2 bg-surface px-2.5 font-normal text-text"
                      />
                    }
                  >
                    <CalendarDays aria-hidden strokeWidth={1.75} className="text-text-muted" />
                    {on && ymd ? formatLong(ymd) : "Pick a date"}
                  </PopoverTrigger>
                  <SunsetCalendarContent
                    ymd={ymd}
                    today={today}
                    align="end"
                    onPick={(next) => {
                      setYmd(next);
                      setError(null);
                      setPickerOpen(false);
                    }}
                  />
                </Popover>
              </div>
              <SunsetZone id={zoneId} zone={zone} />
            </div>
          ) : null}
        </>
      ) : null}
    </ActionDialog>
  );
}
