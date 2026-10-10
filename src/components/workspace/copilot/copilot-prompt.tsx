"use client";

import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrimDialogContent } from "@/components/app-shell/scrim-dialog";
import { BlockedButton } from "@/components/primitives/blocked-button";
import { useCopy } from "@/components/primitives/copy";
import type { CopilotPrompt } from "@/domain/import-types";
import { readTemplate } from "@/lib/template-reads";
import { useWorkspaceSession } from "../session/workspace-session";

const NOT_SAVED = "Your latest changes aren't saved yet.";
const LOAD_FAILED = "Couldn't get the prompt. Try again.";
const COPY_FAILED = "Couldn't copy. Select the prompt and copy it.";
const COPIED_MS = 2000;

/** The quiet row at the end of the rail. */
const ROW = "h-8 w-full justify-start gap-2 rounded-lg px-2 text-[13px] font-normal text-text-muted hover:text-text";

/** What `disabled:` does for a native disabled button, for the `aria-disabled` one that keeps focus. */
const UNUSABLE = "aria-disabled:pointer-events-none aria-disabled:opacity-50";

type PromptState = { status: "loading" } | { status: "ready"; text: string } | { status: "error"; reason: string };

/**
 * "Copilot prompt": a quiet ghost row for the end of the rail, on a draft the viewer can edit (the
 * host decides where it shows). It opens "Prompt for Copilot": the pending autosave goes out first,
 * then the server builds the prompt from the saved draft (GET /api/templates/[templateId]/copilot-prompt)
 * and the dialog shows it in a read-only scrolling block, with the one black **Copy prompt**. After a
 * copy the button reads "Copied" for two seconds. The author pastes Copilot's answer back into the
 * document, where the editor merges it into the sections and turns its placeholders into chips.
 *
 * Every open fetches a fresh prompt (the draft may have changed). Focus starts on Copy prompt, which
 * stays focusable (`aria-disabled`) until the prompt is there; closing returns focus to the row.
 */
export function CopilotPromptButton({ templateId, blocked = null }: { templateId: string; blocked?: string | null }) {
  // An alert has no body for Copilot to write (`copilotUnavailable`): the row stays, greyed, with why.
  if (blocked) {
    return (
      <BlockedButton variant="ghost" reason={blocked} className={ROW}>
        <Sparkles strokeWidth={1.75} className="size-4" aria-hidden />
        Copilot prompt
      </BlockedButton>
    );
  }
  return <CopilotPromptDialog templateId={templateId} />;
}

function CopilotPromptDialog({ templateId }: { templateId: string }) {
  const session = useWorkspaceSession();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PromptState>({ status: "loading" });
  const { copied, copy: copyText, reset: resetCopied } = useCopy(COPIED_MS);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyButton = useRef<HTMLButtonElement>(null);
  const promptBlock = useRef<HTMLPreElement>(null);
  // The latest request: an answer to an earlier open (or after a close) is dropped.
  const request = useRef(0);

  async function load() {
    const id = ++request.current;
    setState({ status: "loading" });
    resetCopied();
    setCopyFailed(false);
    try {
      await session.flush();
      // The host publishes the outcome of that flush on the next render: wait one task for it.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (id !== request.current) return;
      const saved = session.getStatus();
      if (saved.status === "error") {
        setState({ status: "error", reason: saved.error ?? NOT_SAVED });
        return;
      }
      const result = await readTemplate<{ prompt: CopilotPrompt }>(templateId, "copilot-prompt");
      if (id !== request.current) return;
      setState(result.ok ? { status: "ready", text: result.prompt.text } : { status: "error", reason: result.reason });
    } catch (error) {
      unstable_rethrow(error);
      if (id === request.current) setState({ status: "error", reason: LOAD_FAILED });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
    else request.current++;
  }

  async function copy() {
    if (state.status !== "ready") return;
    const ok = await copyText(state.text);
    setCopyFailed(!ok);
    if (!ok) {
      // Select the prompt so ⌘C works.
      const block = promptBlock.current;
      if (block) window.getSelection()?.selectAllChildren(block);
    }
  }

  const ready = state.status === "ready";
  const reason = state.status === "error" ? state.reason : copyFailed ? COPY_FAILED : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" className={ROW} />
        }
      >
        <Sparkles strokeWidth={1.75} className="size-4" aria-hidden />
        Copilot prompt
      </DialogTrigger>
      <ScrimDialogContent
        initialFocus={copyButton}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] flex-col rounded-3xl p-8 sm:max-w-xl"
      >
        <DialogTitle className="display-lg shrink-0">Prompt for Copilot</DialogTitle>

        {/* One box for every state, so nothing moves when the prompt arrives. */}
        <div className="mt-6 h-[min(24rem,calc(100dvh-14rem))] min-h-32 overflow-hidden rounded-xl border border-hairline bg-surface-sunken">
          {ready ? (
            <pre
              ref={promptBlock}
              tabIndex={0}
              aria-label="Prompt"
              className="h-full overflow-y-auto overscroll-contain px-4 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-text outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {state.text}
            </pre>
          ) : (
            <div aria-busy={state.status === "loading"} aria-label="Prompt" className="flex flex-col gap-2.5 px-4 py-4">
              {state.status === "loading"
                ? ["w-4/5", "w-2/5", "w-3/5", "w-1/3", "w-2/3", "w-1/2"].map((width) => (
                    <Skeleton key={width} className={cn("h-3 rounded", width)} />
                  ))
                : null}
            </div>
          )}
        </div>

        <div className="mt-7 flex shrink-0 items-center gap-3">
          {/* Always in the row (empty until something goes wrong), so a reason is announced when it arrives. */}
          <p role="alert" className="min-w-0 flex-1 text-[13px] leading-4 text-danger-text">
            {reason}
          </p>
          <DialogClose render={<Button variant="outline" className="px-4" />}>Close</DialogClose>
          <Button
            ref={copyButton}
            className={cn("px-4", UNUSABLE)}
            onClick={copy}
            disabled={!ready}
            focusableWhenDisabled
          >
            {/* Both labels hold the width, so the button doesn't change size when it says "Copied". */}
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", copied && "invisible")}>Copy prompt</span>
              <span className={cn("col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5", !copied && "invisible")}>
                <Check strokeWidth={2} className="size-4" aria-hidden />
                Copied
              </span>
            </span>
          </Button>
          <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {copied ? "Copied" : ""}
          </span>
        </div>
      </ScrimDialogContent>
    </Dialog>
  );
}
