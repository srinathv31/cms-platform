"use client";

import { useId, useRef, useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BlockedButton } from "@/components/primitives/blocked-button";
import { cn } from "@/lib/utils";
import type { ConsumerUsage, SunsetCalendar, VersionTimelineItem } from "@/domain/review-types";
import { cancelRevoke } from "@/server/actions/review";
import { DESTRUCTIVE_PRIMARY, GENERIC_FAILURE, runAction } from "./action-dialog";
import { entryHeadingId, entryRevokeId } from "./entry-ids";
import { ConfirmRevokeDialog, StartRevokeDialog } from "./revoke-dialogs";
import { SunsetDialog } from "./sunset-dialog";

// The interactive parts of one version's entry. The entry itself is a server component; these are the
// islands in it: the actions at the head (Set sunset, Revoke) and the ones in a pending revoke's
// block (Confirm revoke, Withdraw revoke). An action is shown when the viewer may take it. A blocked
// one is shown only when the reason is the point, disabled, with the reason: the two-person rule, and a
// sunset that has passed (final, so the read model refuses it to everyone who can see the version).
//
// Focus: a dialog that is dismissed (Esc, Cancel) returns focus to the control that opened it. After
// an action goes through, that control is usually gone (the Revoke button turns into a pending
// block), so focus goes to the version's heading instead.

export interface VersionContext {
  templateId: string;
  /** The Active version's number, if any. */
  activeNumber: number | null;
  usage: readonly ConsumerUsage[];
  /** The sunset picker's business time zone and today in it, on the demo clock. */
  sunsetCalendar: SunsetCalendar;
  /** The demo clock's instant. */
  nowIso: string;
}

type Item = Pick<VersionTimelineItem, "id" | "number" | "state" | "sunsetDay" | "sunsetPassed" | "revoke" | "can">;

function pendingRevoke(item: Item): boolean {
  return !!item.revoke && !item.revoke.confirmedAt;
}

const byId = (id: string) => document.getElementById(id);

/**
 * Focuses `id` once it is on the page: a refresh may still be bringing it. Without it by `timeout`,
 * focuses `fallback`, which is always there.
 */
function focusWhenPresent(id: string, fallback: string, timeout = 1500) {
  const start = performance.now();
  const tick = () => {
    const target = byId(id);
    if (target) return target.focus();
    if (performance.now() - start < timeout) return void requestAnimationFrame(tick);
    byId(fallback)?.focus();
  };
  requestAnimationFrame(tick);
}

/** Set sunset (Superseded) and Revoke (Active or Superseded), at the head of the entry. */
export function EntryActions({ ctx, item }: { ctx: VersionContext; item: Item }) {
  const [sunsetOpen, setSunsetOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const sunsetButton = useRef<HTMLButtonElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);
  /** The revoke was started: its button is gone, so focus goes to the heading, not back to it. */
  const started = useRef(false);
  const number = item.number;
  if (number === null) return null;

  const headingId = entryHeadingId(item.id);
  const revoking = pendingRevoke(item);
  // A sunset is for a version that stays; while its revoke waits for a second approver, its fate is that.
  // Once the sunset has passed it stays where it is, disabled, saying why.
  const sunset = item.can.setSunset;
  const showSunset = item.state === "superseded" && !revoking && (sunset.ok || item.sunsetPassed);
  const canRevoke = (item.state === "active" || item.state === "superseded") && !revoking && item.can.startRevoke.ok;
  if (!showSunset && !canRevoke) return null;

  const sunsetLabel = item.sunsetDay ? "Change sunset" : "Set sunset";

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {showSunset && !sunset.ok ? (
        <BlockedButton aria-label={`${sunsetLabel} for v${number}`} reason={sunset.reason} className="gap-1.5 bg-surface">
          <CalendarClock aria-hidden strokeWidth={1.75} />
          {sunsetLabel}
        </BlockedButton>
      ) : null}
      {showSunset && sunset.ok ? (
        <>
          <Button
            ref={sunsetButton}
            variant="outline"
            aria-label={`${sunsetLabel} for v${number}`}
            className="gap-1.5 bg-surface"
            onClick={() => setSunsetOpen(true)}
          >
            <CalendarClock aria-hidden strokeWidth={1.75} />
            {sunsetLabel}
          </Button>
          <SunsetDialog
            open={sunsetOpen}
            onOpenChange={setSunsetOpen}
            templateId={ctx.templateId}
            versionNumber={number}
            currentSunset={item.sunsetDay ?? null}
            activeNumber={ctx.activeNumber}
            usage={ctx.usage}
            calendar={ctx.sunsetCalendar}
            nowIso={ctx.nowIso}
            finalFocus={() => sunsetButton.current}
          />
        </>
      ) : null}
      {canRevoke ? (
        <>
          <Button
            id={entryRevokeId(item.id)}
            ref={revokeButton}
            variant="outline"
            aria-label={`Revoke v${number}`}
            className="bg-surface text-danger-text"
            onClick={() => {
              started.current = false;
              setRevokeOpen(true);
            }}
          >
            Revoke
          </Button>
          <StartRevokeDialog
            open={revokeOpen}
            onOpenChange={setRevokeOpen}
            templateId={ctx.templateId}
            versionNumber={number}
            activeNumber={ctx.activeNumber}
            usage={ctx.usage}
            nowIso={ctx.nowIso}
            onSucceeded={() => {
              started.current = true;
              focusWhenPresent(headingId, headingId);
            }}
            finalFocus={() => (started.current ? byId(headingId) : revokeButton.current)}
          />
        </>
      ) : null}
    </div>
  );
}

/** Confirm revoke and Withdraw revoke, inside a pending revoke's block. */
export function RevokeBlockActions({ ctx, item }: { ctx: VersionContext; item: Item }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  /** The revoke was confirmed: its button is gone, so focus goes to the heading, not back to it. */
  const confirmed = useRef(false);
  const reasonId = useId();
  const number = item.number;
  if (number === null || !item.revoke) return null;

  const headingId = entryHeadingId(item.id);
  const { confirmRevoke: confirm, cancelRevoke: cancel } = item.can;
  // The approver who started the revoke sees Confirm disabled, with why: another approver must confirm it.
  const showConfirm = confirm.ok || confirm.code === "own_revoke";
  const showWithdraw = cancel.ok;
  if (!showConfirm && !showWithdraw) return null;

  const blocked = !confirm.ok ? confirm.reason : null;

  function withdraw() {
    if (pending) return;
    setError(null);
    start(async () => {
      const result = await runAction(() => cancelRevoke({ templateId: ctx.templateId, versionNumber: number as number }));
      // The block is gone and the entry's Revoke button is back (once the refresh lands): focus goes to it.
      if (result.ok) focusWhenPresent(entryRevokeId(item.id), headingId);
      else setError(result.reason || GENERIC_FAILURE);
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {showConfirm ? (
          <Button
            ref={confirmButton}
            variant="destructive"
            // `aria-disabled`, not `disabled`: it stays focusable, so the reason it is blocked can be read from it.
            aria-disabled={!confirm.ok || pending || undefined}
            aria-describedby={blocked ? reasonId : undefined}
            className={cn(DESTRUCTIVE_PRIMARY, !confirm.ok && "opacity-50")}
            onClick={() => {
              if (!confirm.ok || pending) return;
              confirmed.current = false;
              setConfirmOpen(true);
            }}
          >
            Confirm revoke
          </Button>
        ) : null}
        {showWithdraw ? (
          <Button
            variant="outline"
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            className="relative bg-surface text-danger-text hover:text-danger-text"
            onClick={withdraw}
          >
            <span className={cn(pending && "invisible")}>Withdraw revoke</span>
            {pending ? <Spinner aria-hidden role="presentation" className="absolute size-3.5" /> : null}
          </Button>
        ) : null}
      </div>
      {blocked ? (
        <p id={reasonId} className="text-[13px] leading-5 text-danger-text/80">
          {blocked}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] leading-5 text-danger-text">
          {error}
        </p>
      ) : null}
      {confirm.ok ? (
        <ConfirmRevokeDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          templateId={ctx.templateId}
          versionNumber={number}
          activeNumber={ctx.activeNumber}
          usage={ctx.usage}
          nowIso={ctx.nowIso}
          startedBy={item.revoke.startedBy.name}
          reason={item.revoke.reason}
          onSucceeded={() => {
            confirmed.current = true;
            focusWhenPresent(headingId, headingId);
          }}
          finalFocus={() => (confirmed.current ? byId(headingId) : confirmButton.current)}
        />
      ) : null}
    </div>
  );
}
