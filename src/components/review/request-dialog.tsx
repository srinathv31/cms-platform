"use client";

import { useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ActionDialog, useActionDialog } from "@/components/versions/action-dialog";
import { requestChanges } from "@/server/actions/review";
import { reasonProblem, reasonReady } from "./decision-model";

/**
 * Send a version back to its author: a required reason, which becomes the first comment on the
 * version, and the author's new draft carries the review's comments. Primary: "Request changes".
 * The description is the consequence and nothing else (the field's label says what it is for). A
 * refusal from the server shows at the button; the dialog closes only on success. A reason that is too
 * long says so at the field as it happens; an empty one isn't nagged and isn't explained: pressing the
 * button marks the field and puts the caret in it.
 */
export function RequestChangesDialog({
  open,
  onOpenChange,
  templateId,
  versionNumber,
  round,
  authorName,
  onRequested,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  versionNumber: number;
  /** The round on screen: the change request sends exactly it back. */
  round: number;
  authorName: string;
  /** The change request went through (called before the dialog closes). */
  onRequested: () => void;
  finalFocus?: () => HTMLElement | null;
}) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const { pending, error, setError, submit } = useActionDialog(() => onOpenChange(false));
  const ready = reasonReady(reason);
  const problem = reasonProblem(reason);
  // Empty and tried: marked invalid, without a sentence.
  const marked = problem !== null || (tried && !ready);
  const fieldId = `request-${versionNumber}-reason`;
  const problemId = `${fieldId}-problem`;

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setReason("");
        setTried(false);
        setError(null);
      }}
      title="Request changes"
      description={`${authorName} gets a new draft of v${versionNumber} with your reason and the comments.`}
      error={error}
      busy={pending}
      initialFocus={field}
      finalFocus={finalFocus}
      primary={{
        label: "Request changes",
        blocked: !ready,
        onClick: () => {
          if (!ready) {
            setTried(true);
            field.current?.focus();
            return;
          }
          submit(null, async () => {
            const result = await requestChanges({ templateId, versionNumber, round, reason: reason.trim() });
            if (result.ok) onRequested();
            return result;
          });
        },
      }}
    >
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
          rows={4}
          readOnly={pending}
          aria-required="true"
          aria-invalid={marked ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          onBlur={() => reason.length > 0 && setTried(true)}
          className="min-h-28 resize-none rounded-lg bg-surface text-[14px] leading-[1.55]"
        />
      </div>
    </ActionDialog>
  );
}
