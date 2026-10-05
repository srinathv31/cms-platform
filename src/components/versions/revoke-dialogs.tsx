"use client";

import { useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { consequences } from "@/domain/consequences";
import type { ConsumerUsage } from "@/domain/review-types";
import { confirmRevoke, startRevoke } from "@/server/actions/review";
import { ActionDialog, Consequences, useActionDialog } from "./action-dialog";
import { REVOKE_REASON_MAX, validateRevokeReason } from "./validation";

interface Shared {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  versionNumber: number;
  activeNumber: number | null;
  usage: readonly ConsumerUsage[];
  /** The demo clock's instant. */
  nowIso: string;
  /** Where focus goes when the dialog closes: the opener on a dismissal, the entry's heading after the action. */
  finalFocus?: () => HTMLElement | null;
  /** The action went through (called before the dialog closes). */
  onSucceeded?: () => void;
}

/**
 * Start a revoke: a reason (required) and what it will do once another approver confirms it. Starting
 * only requests the revoke (the two-person rule), so the dialog says so first and words the effects
 * in the future tense. Primary: "Start revoke", destructive.
 *
 * The reason's problem (blank, or too long) shows at the field when the person tries: when they press
 * Start revoke (or ⌘Enter), or leave a field that holds only blanks. An empty field isn't nagged.
 */
export function StartRevokeDialog({
  open,
  onOpenChange,
  templateId,
  versionNumber,
  activeNumber,
  usage,
  nowIso,
  finalFocus,
  onSucceeded,
}: Shared) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const { pending, error, setError, submit } = useActionDialog(() => {
    onSucceeded?.();
    onOpenChange(false);
  });
  const invalid = validateRevokeReason(reason);
  const lines = useMemo(
    () => consequences({ kind: "revoke", number: versionNumber, activeNumber, pending: true }, usage, new Date(nowIso)),
    [versionNumber, activeNumber, usage, nowIso],
  );
  const fieldId = `revoke-${versionNumber}-reason`;
  const problemId = `${fieldId}-problem`;
  // Too long is said as it happens; blank, once they've tried (or left a field that holds only blanks).
  const problem = invalid !== null && (tried || reason.trim().length > REVOKE_REASON_MAX) ? invalid : null;

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setReason("");
        setTried(false);
        setError(null);
      }}
      title={`Revoke v${versionNumber}`}
      description="Another approver must confirm before this takes effect."
      error={error}
      busy={pending}
      initialFocus={field}
      finalFocus={finalFocus}
      primary={{
        label: "Start revoke",
        destructive: true,
        blocked: invalid !== null,
        onClick: () => {
          if (invalid) {
            setTried(true);
            field.current?.focus();
            return;
          }
          submit(null, () => startRevoke({ templateId, versionNumber, reason: reason.trim() }));
        },
      }}
    >
      <Consequences lines={lines} />
      <div className="flex flex-col gap-2">
        <div className="flex min-h-5 items-baseline justify-between gap-3">
          <Label htmlFor={fieldId} className="caps-label">
            Reason
          </Label>
          {problem ? (
            <p id={problemId} className="text-[13px] leading-5 text-danger-text">
              {problem}
            </p>
          ) : null}
        </div>
        <Textarea
          id={fieldId}
          ref={field}
          value={reason}
          rows={3}
          readOnly={pending}
          aria-required="true"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          onBlur={() => reason.length > 0 && setTried(true)}
          className="min-h-20 resize-none rounded-lg bg-surface text-[14px] leading-[1.55]"
        />
      </div>
    </ActionDialog>
  );
}

/**
 * Confirm a revoke another approver started. Renders stop immediately once it's confirmed, so the
 * safe action (Cancel) has the focus. Primary: "Confirm revoke", destructive.
 */
export function ConfirmRevokeDialog({
  open,
  onOpenChange,
  templateId,
  versionNumber,
  activeNumber,
  usage,
  nowIso,
  startedBy,
  reason,
  finalFocus,
  onSucceeded,
}: Shared & { startedBy: string; reason: string }) {
  const { pending, error, setError, submit } = useActionDialog(() => {
    onSucceeded?.();
    onOpenChange(false);
  });
  const lines = useMemo(
    () => consequences({ kind: "revoke", number: versionNumber, activeNumber }, usage, new Date(nowIso)),
    [versionNumber, activeNumber, usage, nowIso],
  );

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => setError(null)}
      title={`Confirm revoke of v${versionNumber}`}
      description={`Confirming stops v${versionNumber} from rendering right away.`}
      error={error}
      busy={pending}
      focusCancel
      finalFocus={finalFocus}
      primary={{
        label: "Confirm revoke",
        destructive: true,
        onClick: () => submit(null, () => confirmRevoke({ templateId, versionNumber })),
      }}
    >
      <p className="text-[14px] leading-[1.55] text-text">
        <span className="font-medium">{startedBy}</span> started this revoke: <span className="whitespace-pre-line">&ldquo;{reason}&rdquo;</span>
      </p>
      <Consequences lines={lines} />
    </ActionDialog>
  );
}
