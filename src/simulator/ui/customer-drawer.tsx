"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ExternalLink, Mail, X } from "lucide-react";
import { PushPreview, ScreenPreview, SmsPreview, type DeviceSettings, type PushScreen } from "@/components/device";
import type { ApiChannel } from "@/contracts/api-v1";
import { cn } from "@/lib/utils";
import type { SimDeliveryResult, SimDeliveryView, SimPlatform } from "@/simulator/types";
import { Skeleton } from "@/components/ui/skeleton";
import { assertNever } from "../assert-never";
import { Btn, Strip, btnClass } from "./bits";
import { CHANNEL_LABEL, PLATFORM_LABEL, VIEW_LABEL, messageStamp, phoneClock, phoneLabel, plural, whenLabel } from "./format";

export type ViewState = { status: "loading" } | { status: "ready"; view: SimDeliveryView } | { status: "error"; reason: string };

/** A delivery that came in while the drawer was open, and the one it replaces on screen until it loads. */
export interface Arrival {
  deliveryId: string;
  previous: string | null;
}

type View = NonNullable<SimDeliveryView["view"]>;

const CHANNEL_ORDER: ApiChannel[] = ["web", "email", "pdf", "push", "sms"];

/** Whether the channel shows on the customer's phone (the drawer then fills its height with it). */
function onPhone(channel: ApiChannel): boolean {
  switch (channel) {
    case "web":
    case "push":
    case "sms":
      return true;
    case "email":
    case "pdf":
      return false;
    default:
      return assertNever(channel, "channel");
  }
}

/** The customer's phone: their platform at its standard width, light, with previews shown. */
const phoneSettings = (platform: SimPlatform): DeviceSettings => ({
  platform,
  appearance: "light",
  previewsHidden: false,
  textSize: "default",
  width: "standard",
});

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

/** The web page on the customer's phone, under Coral's own app bar. */
function WebPhone({ view, delivery }: { view: Extract<View, { kind: "phone" }>; delivery: SimDeliveryView }) {
  return (
    <ScreenPreview settings={phoneSettings(delivery.customer.platform)} caption="Web page from Coral" clock={phoneClock(delivery.at)}>
      <div aria-hidden className="flex h-11 shrink-0 items-center gap-1 border-b border-(--sim-paper-line) px-3">
        <ChevronLeft className="size-5" strokeWidth={1.75} />
        <span className="flex-1 pr-5 text-center text-[14px] font-semibold">Offer terms</span>
      </div>
      <iframe title={`${delivery.customer.name} · Web`} src={view.src} sandbox="" className="min-h-0 w-full flex-1 border-0 bg-(--sim-paper)" />
    </ScreenPreview>
  );
}

/**
 * The push on the customer's lock screen. One that arrived while the drawer was open drops in as a banner
 * (a heads-up on Android) instead, once. Clicking the notification opens it, as on a phone.
 */
function PushPhone({ view, delivery, screen, onScreen }: { view: Extract<View, { kind: "push" }>; delivery: SimDeliveryView; screen: PushScreen; onScreen: (s: PushScreen) => void }) {
  const { push, appName } = view;
  return (
    <PushPreview
      settings={phoneSettings(view.platform)}
      screen={screen}
      onScreenChange={onScreen}
      clock={phoneClock(delivery.at)}
      content={{ appName, appMark: { monogram: Array.from(appName)[0] ?? "" }, title: push.title, subtitle: push.subtitle, body: push.body, time: "now" }}
    />
  );
}

/** The customer's thread with Coral's short code, opened on the newest text. */
function SmsPhone({ view, delivery }: { view: Extract<View, { kind: "sms" }>; delivery: SimDeliveryView }) {
  const newest = view.thread[view.thread.length - 1]!;
  const stamps = view.thread.map((sms) => messageStamp(sms.at, newest.at));
  return (
    <SmsPreview
      settings={phoneSettings(delivery.customer.platform)}
      clock={phoneClock(newest.at)}
      content={{
        sender: view.sender,
        text: newest.text,
        ...stamps[stamps.length - 1]!,
        earlier: view.thread.slice(0, -1).map((sms, i) => ({ text: sms.text, ...stamps[i]! })),
      }}
    />
  );
}

/** What Stencil reported about what is on the phone: a push's size, a text's encoding and parts. */
function measured(view: View): string | null {
  switch (view.kind) {
    case "push":
      return `${view.push.payloadBytes.toLocaleString("en-US")} bytes`;
    case "sms": {
      const newest = view.thread[view.thread.length - 1];
      return newest ? `${newest.encoding} · ${plural(newest.parts, "part", "parts")} · ${plural(newest.characters, "character", "characters")}` : null;
    }
    case "phone":
    case "inbox":
    case "pdf":
      return null;
    default:
      return assertNever(view, "view");
  }
}

function InboxFrame({ view, to, name }: { view: Extract<View, { kind: "inbox" }>; to: string; name: string }) {
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

function PdfFrame({ view, name }: { view: Extract<View, { kind: "pdf" }>; name: string }) {
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
 * with the channels the send rendered as a switch. The web page, the push and the texts show on the
 * customer's own phone (the phone kit, on their platform); the email in an inbox and the PDF in a viewer.
 * Everything is Coral's stored copy of what Stencil rendered.
 */
export function CustomerDrawer({
  customerName,
  results,
  channel,
  views,
  arrival,
  onChannel,
  onClose,
}: {
  customerName: string;
  results: SimDeliveryResult[];
  channel: ApiChannel;
  views: Record<string, ViewState>;
  arrival: Arrival | null;
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
  let state = result ? views[result.deliveryId] : undefined;
  // A delivery that just came in keeps the one before it on the phone until it loads.
  if (result && arrival?.deliveryId === result.deliveryId && state?.status !== "ready" && arrival.previous) {
    const previous = views[arrival.previous];
    if (previous?.status === "ready") state = previous;
  }
  const ready = state?.status === "ready" ? state.view : null;

  // The push screen the person chose, for the delivery on screen; else the lock screen, or the banner for
  // one that arrived while the drawer was open.
  const [chosen, setChosen] = useState<{ id: string; screen: PushScreen } | null>(null);
  const screen: PushScreen = ready && chosen?.id === ready.id ? chosen.screen : ready && arrival?.deliveryId === ready.id ? "banner" : "lock";

  const options = CHANNEL_ORDER.filter((c) => results.some((r) => r.channel === c)).map((c) => ({ value: c, label: VIEW_LABEL[c] }));
  const filename = ready ? `${ready.templateName} · v${ready.versionNumber}`.replace(/\s+/g, " ") : "Offer terms";
  const phone = onPhone(result?.channel ?? channel);
  const view = ready?.view ?? null;
  const platform = view?.kind === "push" ? view.platform : ready?.customer.platform;

  let body: React.ReactNode;
  if (!state || state.status === "loading") {
    body = phone ? (
      <Skeleton aria-hidden className="mx-auto h-full w-full max-w-[26rem] rounded-[3.5rem] bg-(--sim-line)" />
    ) : (
      <Skeleton aria-hidden className="h-[34rem] w-full rounded-lg bg-(--sim-line)" />
    );
  } else if (state.status === "error") body = <Strip tone="bad">{state.reason}</Strip>;
  else if (view === null) body = <Strip tone="bad">{state.view.error?.message ?? "Nothing was delivered."}</Strip>;
  else {
    const delivery = state.view;
    switch (view.kind) {
      case "phone":
        body = <WebPhone view={view} delivery={delivery} />;
        break;
      case "push":
        body = <PushPhone view={view} delivery={delivery} screen={screen} onScreen={(s) => setChosen({ id: delivery.id, screen: s })} />;
        break;
      case "sms":
        body = view.thread.length > 0 ? <SmsPhone view={view} delivery={delivery} /> : <Strip tone="bad">Nothing was delivered.</Strip>;
        break;
      case "inbox":
        body = <InboxFrame view={view} to={delivery.customer.email} name={delivery.customer.name} />;
        break;
      case "pdf":
        body = <PdfFrame view={view} name={filename} />;
        break;
      default:
        body = assertNever(view, "view");
    }
  }
  const measure = view ? measured(view) : null;

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
      {phone ? (
        <div className="flex min-h-0 flex-1 flex-col bg-(--sim-bg) px-4 pt-3 pb-14">
          <p className="m-0 mb-3 flex h-5 shrink-0 items-center justify-between gap-3 text-[12px] text-(--sim-muted)">
            <span className="truncate">
              {ready && platform ? (
                <>
                  {PLATFORM_LABEL[platform]} · <span className="tabular-nums">{phoneLabel(ready.customer.phone)}</span>
                </>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums">{measure}</span>
          </p>
          <div className="min-h-0 flex-1">{body}</div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-(--sim-bg) p-4 pb-14">{body}</div>
      )}
    </aside>
  );
}
