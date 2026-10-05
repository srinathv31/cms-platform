"use client";

import { useCallback, useRef, useState } from "react";
import { IntegrationBody, IntegrationIdentity, IntegrationSkeleton } from "@/components/integration/integration-panel";
import { ShareRing } from "@/components/signature/share-ring";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { IntegrationPanelData } from "@/domain/golive-types";
import { loadIntegrationPanel } from "@/server/actions/integration";

/**
 * The SHARE signature on an Active template. Opens the integration panel for consumer teams: the
 * contract, the JSON Schema, a sample request, the response formats and what changed since older
 * versions. The data loads through a server action (on hover or focus of the ring as a prefetch, and on
 * open), so the headers that host the ring keep their props.
 */

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside the panel. Base UI's focus guards do the same, but they hand focus over a
 * frame late, and a fast Tab slips through to the page behind.
 */
function wrapTab(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const at = document.activeElement;
  if (event.shiftKey && (at === first || !event.currentTarget.contains(at) || at === event.currentTarget)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && at === last) {
    event.preventDefault();
    first.focus();
  }
}

/** A load younger than this is reused when the sheet opens. */
const FRESH_MS = 15_000;
const FAILED = "The integration details didn't load.";

type LoadState =
  | { key: string; kind: "idle" }
  | { key: string; kind: "loading" }
  | { key: string; kind: "ready"; panel: IntegrationPanelData }
  | { key: string; kind: "error"; reason: string };

export function WorkspaceShare({
  templateId,
  templateName,
  activeVersion,
}: {
  templateId: string;
  templateName: string;
  activeVersion: number;
}) {
  const key = `${templateId}:${activeVersion}`;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ key, kind: "idle" });
  const inflight = useRef<Promise<void> | null>(null);
  const loadedAt = useRef({ key, at: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);

  // A state from another template or version is as good as none.
  const view: LoadState = state.key === key ? state : { key, kind: "idle" };

  const load = useCallback(
    (force = false) => {
      if (inflight.current) return inflight.current;
      const fresh = loadedAt.current.key === key && Date.now() - loadedAt.current.at < FRESH_MS;
      if (fresh && !force) return Promise.resolve();
      setState((s) => (s.key === key && s.kind === "ready" ? s : { key, kind: "loading" }));
      const run = loadIntegrationPanel({ templateId })
        .then((res) => {
          if (res.ok) {
            loadedAt.current = { key, at: Date.now() };
            setState({ key, kind: "ready", panel: res.panel });
          } else {
            setState((s) => (s.key === key && s.kind === "ready" ? s : { key, kind: "error", reason: res.reason }));
          }
        })
        .catch(() => setState((s) => (s.key === key && s.kind === "ready" ? s : { key, kind: "error", reason: FAILED })))
        .finally(() => {
          inflight.current = null;
        });
      inflight.current = run;
      return run;
    },
    [key, templateId],
  );

  const panel = view.kind === "ready" ? view.panel : null;

  return (
    <>
      <ShareRing
        onClick={() => {
          setOpen(true);
          void load();
        }}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        label={`Share ${templateName} — integration details`}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          initialFocus={bodyRef}
          showCloseButton={false}
          aria-modal="true"
          onKeyDown={wrapTab}
          className="w-[40rem] gap-0 border-hairline bg-canvas p-0 data-[side=right]:sm:max-w-[40rem]"
        >
          <SheetHeader className="relative shrink-0 gap-1.5 border-b border-hairline px-7 pt-7 pb-5">
            <SheetClose
              render={<Button variant="ghost" size="icon" className="absolute top-4 right-5" />}
            >
              <XIcon aria-hidden strokeWidth={1.75} />
              <span className="sr-only">Close</span>
            </SheetClose>
            <div className="caps-label">Integration</div>
            <SheetTitle className="display-lg text-text">{templateName}</SheetTitle>
            <SheetDescription className="sr-only">
              Template ID, active version and the variable contract for consumer teams.
            </SheetDescription>
          </SheetHeader>
          <div
            ref={bodyRef}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto overscroll-contain px-7 pt-6 pb-16 outline-none"
          >
            <IntegrationIdentity
              templateId={templateId}
              activeVersion={panel?.active.number ?? activeVersion}
              channels={panel?.active.channels ?? null}
            />
            {panel ? (
              <IntegrationBody panel={panel} />
            ) : view.kind === "error" ? (
              <div role="alert" className="flex flex-col items-start gap-3 text-[14px] text-text">
                <p>{view.reason}</p>
                <Button variant="outline" className="h-8 bg-surface px-3 text-[13px]" onClick={() => void load(true)}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <span role="status" className="sr-only">
                  Loading integration details
                </span>
                <IntegrationSkeleton />
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
