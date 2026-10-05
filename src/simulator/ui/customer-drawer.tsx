"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ExternalLink, Mail, X } from "lucide-react";
import type { ApiChannel } from "@/contracts/api-v1";
import { cn } from "@/lib/utils";
import type { SimDeliveryResult, SimDeliveryView } from "@/simulator/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Btn, Strip, btnClass } from "./bits";
import { CHANNEL_LABEL, VIEW_LABEL, whenLabel } from "./format";

export type ViewState = { status: "loading" } | { status: "ready"; view: SimDeliveryView } | { status: "error"; reason: string };

const CHANNEL_ORDER: ApiChannel[] = ["web", "email", "pdf"];

/** Small segmented control (Coral's one picker style). */
function Seg({ label, value, options, onChange }: { label: string; value: ApiChannel; options: { value: ApiChannel; label: string }[]; onChange: (v: ApiChannel) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 w-fit items-center rounded-(--sim-rb) border border-(--sim-line) bg-(--sim-panel2) p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[3px] px-3 text-[12px] font-medium transition-colors",
            o.value === value ? "bg-(--sim-panel) text-(--sim-text) shadow-[0_0_0_1px_var(--sim-line)]" : "text-(--sim-muted) hover:text-(--sim-text)",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PhoneFrame({ view, name }: { view: Extract<NonNullable<SimDeliveryView["view"]>, { kind: "phone" }>; name: string }) {
  return (
    <div className="mx-auto w-[286px] rounded-[40px] border-[7px] border-(--sim-device) bg-(--sim-device)">
      <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[32px] bg-(--sim-paper)">
        <div aria-hidden className="absolute top-2 left-1/2 h-[18px] w-20 -translate-x-1/2 rounded-full bg-(--sim-device)" />
        <div aria-hidden className="flex h-9 shrink-0 items-end px-5 pb-1 text-[11px] font-semibold text-(--sim-device)">
          9:41
        </div>
        <div aria-hidden className="flex h-11 shrink-0 items-center gap-1 border-b border-(--sim-paper-line) px-3">
          <ChevronLeft className="size-5 text-(--sim-device)" strokeWidth={1.75} />
          <span className="flex-1 pr-5 text-center text-[14px] font-semibold text-(--sim-device)">Offer terms</span>
        </div>
        <iframe title={`${name} · Web`} src={view.src} sandbox="" className="min-h-0 w-full flex-1 border-0 bg-(--sim-paper)" />
      </div>
    </div>
  );
}

function InboxFrame({ view, to, name }: { view: Extract<NonNullable<SimDeliveryView["view"]>, { kind: "inbox" }>; to: string; name: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-(--sim-line) bg-(--sim-paper) text-(--sim-paper-text)">
      <div aria-hidden className="flex h-8 items-center gap-1.5 border-b border-(--sim-paper-line) bg-(--sim-panel2) px-3 text-[11px] text-(--sim-paper-muted)">
        <Mail className="size-3" strokeWidth={1.75} /> Inbox
      </div>
      <div className="p-4 pb-3">
        <h3 className="m-0 text-[15px] leading-snug font-semibold break-words">{view.subject || "(No subject)"}</h3>
        <p className="mt-1 mb-0 text-[11px] break-all text-(--sim-paper-muted)">From {view.from}</p>
        <p className="m-0 text-[11px] break-all text-(--sim-paper-muted)">To {to}</p>
        {view.preheader ? <p className="mt-1.5 mb-0 text-[12px] break-words text-(--sim-paper-muted)">{view.preheader}</p> : null}
      </div>
      <iframe title={`${name} · Email`} src={view.src} sandbox="" className="h-[26rem] w-full border-0 border-t border-(--sim-paper-line) bg-(--sim-paper)" />
    </div>
  );
}

function PdfFrame({ view, name }: { view: Extract<NonNullable<SimDeliveryView["view"]>, { kind: "pdf" }>; name: string }) {
  return (
    <div className="rounded-lg bg-(--sim-viewer) p-2">
      <div className="mb-2 flex h-8 items-center justify-between gap-2 px-1 text-[12px] text-(--sim-paper)">
        <span className="min-w-0 truncate">{name}.pdf</span>
        <a href={view.src} target="_blank" rel="noopener noreferrer" className={btnClass("secondary", "h-7")}>
          Open PDF <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.75} />
        </a>
      </div>
      <iframe title={`${name} · PDF`} src={view.src} className="h-[34rem] w-full rounded-[3px] border-0 bg-(--sim-paper)" />
    </div>
  );
}

/**
 * The customer view: a right-hand drawer, a dialog named "{Customer} · {Channel}". One customer at a time,
 * with the channels the send rendered as a Phone / Inbox / PDF switch. The documents are Coral's stored
 * copies of what UCOMP rendered, served by /sim/deliveries/[id]/file.
 */
export function CustomerDrawer({
  customerName,
  results,
  channel,
  views,
  onChannel,
  onClose,
}: {
  customerName: string;
  results: SimDeliveryResult[];
  channel: ApiChannel;
  views: Record<string, ViewState>;
  onChannel: (c: ApiChannel) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Initial focus: the close button. Esc closes the drawer (it is the topmost thing here).
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const result = results.find((r) => r.channel === channel) ?? results[0];
  const state = result ? views[result.deliveryId] : undefined;
  const ready = state?.status === "ready" ? state.view : null;
  const options = CHANNEL_ORDER.filter((c) => results.some((r) => r.channel === c)).map((c) => ({ value: c, label: VIEW_LABEL[c] }));
  const filename = ready ? `${ready.templateName} · v${ready.versionNumber}`.replace(/\s+/g, " ") : "Offer terms";

  return (
    <aside
      role="dialog"
      aria-label={`${customerName} · ${CHANNEL_LABEL[channel]}`}
      className="flex w-[28rem] shrink-0 flex-col border-l border-(--sim-line) bg-(--sim-panel)"
    >
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-(--sim-line) px-4 py-2">
        <div className="min-w-0">
          <h2 className="m-0 text-[13px] leading-5 font-semibold break-words">{customerName}</h2>
          <p className="m-0 truncate text-[11px] text-(--sim-muted)">
            {ready ? `${ready.offerName} · v${ready.versionNumber} · ${whenLabel(ready.at)}` : " "}
          </p>
        </div>
        <Btn ref={closeRef} kind="ghost" className="size-8 px-0" aria-label="Close" onClick={onClose}>
          <X aria-hidden className="size-4" />
        </Btn>
      </div>
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-(--sim-line)">
        <Seg label="Customer view" value={channel} options={options} onChange={onChannel} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-(--sim-bg) p-4 pb-14">
        {!state || state.status === "loading" ? (
          <Skeleton aria-hidden className="mx-auto h-[574px] w-[286px] rounded-[40px] bg-(--sim-line)" />
        ) : state.status === "error" ? (
          <Strip tone="bad">{state.reason}</Strip>
        ) : state.view.view === null ? (
          <Strip tone="bad">{state.view.error?.message ?? "Nothing was delivered."}</Strip>
        ) : state.view.view.kind === "phone" ? (
          <PhoneFrame view={state.view.view} name={state.view.customer.name} />
        ) : state.view.view.kind === "inbox" ? (
          <InboxFrame view={state.view.view} to={state.view.customer.email} name={state.view.customer.name} />
        ) : (
          <PdfFrame view={state.view.view} name={filename} />
        )}
      </div>
    </aside>
  );
}
