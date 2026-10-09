"use client";

import { useId, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import { unstable_rethrow } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { ChannelSelector } from "@/components/workspace/content/channels";
import { BreakingBadge } from "@/components/review-queue/breaking-badge";
import type { ActionResult } from "@/domain/review-types";
import { contractSection, splitCode, splitKeys, type ContractLine } from "./contract-lines";
import type { SubmitSummary } from "./types";

const SUBMIT_FAILED = "Couldn't submit. Try again.";
const noop = () => undefined;
/** What `disabled:` does for a native disabled button, for the `aria-disabled` one that keeps focus. */
const PENDING = "aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** A line of the contract section, its keys and types in Geist Mono. Breaking lines carry the warning tokens. */
function ContractRow({ line }: { line: ContractLine }) {
  return (
    <li
      className={cn(
        "flex items-start gap-2.5 border-b border-hairline px-3.5 py-2.5 text-[13px] leading-5 last:border-b-0",
        line.breaking ? "bg-warning-soft text-warning-text" : "text-text-muted",
      )}
    >
      <span aria-hidden className="mt-[3px] grid size-3.5 shrink-0 place-items-center">
        {line.breaking ? (
          <TriangleAlert strokeWidth={2} className="size-3.5" />
        ) : (
          <span className="size-1.5 rounded-full bg-current opacity-60" />
        )}
      </span>
      <span className="min-w-0">
        {line.breaking ? <span className="sr-only">Breaking: </span> : null}
        {splitCode(line.text).map((part, index) =>
          part.code ? (
            <code key={index} className="font-mono text-[12px]">
              {part.text}
            </code>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </span>
    </li>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-[22px] items-center justify-between gap-3">
        <h3 className="caps-label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export interface SubmitDialogProps {
  /** What the dialog lists. Kept after it closes, so the text doesn't change while the dialog fades out. */
  summary: SubmitSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes without submitting: the button that opened it. */
  finalFocus: RefObject<HTMLElement | null>;
  /** Submits the version with the note (undefined when it is blank). */
  onSubmit: (note: string | undefined) => Promise<ActionResult<{ number: number }>>;
}

/**
 * "Submit v{N} for review": what is about to be frozen (channels, sample data sets, and the contract
 * changes against the newest version that still renders), an optional note to the reviewers, and the
 * screen's one black button. A refusal shows its reason at the button and the dialog stays; success
 * closes it, and the page behind re-renders in place as In review. Focus starts in the note; Enter there
 * is a new line and ⌘Enter (Ctrl+Enter) submits.
 *
 * The shell is the one every action dialog has: 512px wide, 32px padding, the title, a one-line
 * description, the body, and a footer with an outline Cancel and the primary. No Close X (Esc and Cancel
 * close it).
 *
 * While the server works, nothing that holds focus is `disabled`: a disabled control drops focus to the
 * page, and the next Tab would leave the dialog for the sidebar. The note is read-only and the buttons
 * are `aria-disabled` (`focusableWhenDisabled`), so after a refusal focus is still where it was.
 */
export function SubmitDialog({ summary, open, onOpenChange, finalFocus, onSubmit }: SubmitDialogProps) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();

  const contract = useMemo(
    () =>
      summary
        ? contractSection({ baseline: summary.baseline, variables: summary.variables, versionNumber: summary.number })
        : null,
    [summary],
  );

  function close() {
    // Closing mid-submit would hide the outcome.
    if (pending) return;
    setReason(null);
    onOpenChange(false);
  }

  function submit() {
    if (pending || !summary) return;
    setReason(null);
    startTransition(async () => {
      try {
        const trimmed = note.trim();
        const result = await onSubmit(trimmed === "" ? undefined : trimmed);
        if (!result.ok) {
          setReason(result.reason);
          return;
        }
        setNote("");
        onOpenChange(false);
      } catch (error) {
        unstable_rethrow(error);
        setReason(SUBMIT_FAILED);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <ScrimDialogContent
        initialFocus={noteRef}
        finalFocus={finalFocus}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] flex-col rounded-3xl p-8 sm:max-w-lg"
      >
        {summary ? (
          <>
            <DialogTitle className="display-lg shrink-0">Submit v{summary.number} for review</DialogTitle>
            <DialogDescription className="mt-2 shrink-0 text-[14px] leading-6 text-text-muted">
              The version is frozen as it is and sent to your team&rsquo;s approvers.
            </DialogDescription>

            {/* The scroll area runs out to the dialog's edges (so its scrollbar sits at the edge); the content keeps the 32px. */}
            <div className="-mx-8 mt-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-8 pb-1">
              <Section title="Channels">
                <ChannelSelector channels={summary.channels} allowed={summary.channels} editable={false} onChange={noop} />
              </Section>

              <Section title="Sample data">
                <ul aria-label="Sample data sets" className="flex flex-wrap gap-x-2 text-[14px] leading-6 text-text">
                  {/* The dot trails the name before it, so a wrap never leaves one at the start of a line. */}
                  {summary.sampleSetNames.map((name, index) => (
                    <li key={name} className="flex gap-2">
                      {name}
                      {index < summary.sampleSetNames.length - 1 ? (
                        <span aria-hidden className="text-text-subtle">
                          ·
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Section>

              {contract ? (
                <Section title="Contract changes" aside={contract.breaking ? <BreakingBadge /> : null}>
                  {contract.lines.length > 0 ? (
                    <ul className="overflow-hidden rounded-xl border border-hairline">
                      {contract.lines.map((line) => (
                        <ContractRow key={line.text} line={line} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] leading-5 text-text-muted">No contract changes from v{contract.baselineNumber}.</p>
                  )}
                </Section>
              ) : null}

              <section className="flex flex-col gap-2">
                <label htmlFor={noteId} className="caps-label flex min-h-[22px] items-center">
                  Note to reviewers
                </label>
                <Textarea
                  id={noteId}
                  ref={noteRef}
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  readOnly={pending}
                  aria-busy={pending}
                  className="max-h-40 min-h-20 resize-none rounded-lg border-hairline bg-surface px-3 py-2 text-[14px] leading-5 aria-busy:opacity-60 md:text-[14px]"
                />
              </section>
            </div>

            <div className="mt-7 flex shrink-0 items-center gap-3">
              {/* Always in the row (empty until a refusal), so it is announced when the reason arrives. */}
              <p role="alert" className="min-w-0 flex-1 text-[13px] leading-4 text-danger-text">
                {reason
                  ? splitKeys(reason).map((part, index) =>
                      part.code ? (
                        <code key={index} className="font-mono text-[12px]">
                          {part.text}
                        </code>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )
                  : null}
              </p>
              <Button variant="outline" className={cn("px-4", PENDING)} onClick={close} disabled={pending} focusableWhenDisabled>
                Cancel
              </Button>
              <Button className={cn("relative px-4", PENDING)} onClick={submit} disabled={pending} focusableWhenDisabled>
                <span className={cn(pending && "invisible")}>Submit v{summary.number}</span>
                {pending ? <Spinner aria-label="Submitting" className="absolute" /> : null}
              </Button>
            </div>
          </>
        ) : null}
      </ScrimDialogContent>
    </Dialog>
  );
}
