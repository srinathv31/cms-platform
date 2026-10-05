"use client";

import { BufferedFrame } from "./buffered-frame";
import { WELL_INSET } from "./well";

/**
 * The Email channel in a mail-client frame: who it is from and to, the subject (as the route
 * resolved it), the preheader as the muted snippet a client shows under it, then the body in a
 * sandboxed frame as tall as its content, so the well scrolls the whole message like a mail client.
 */
export function EmailOutput({
  subject,
  preheader,
  html,
  senderName,
  senderAddress,
  recipient,
}: {
  subject: string;
  preheader: string;
  html: string;
  /** The team's name: "Coral Offers". */
  senderName: string;
  /** A plausible no-reply address for it: "no-reply@coraloffers.example". */
  senderAddress: string;
  /** Who the sample set makes the message out to; null when the set has no name in it. */
  recipient: string | null;
}) {
  return (
    <div className={WELL_INSET}>
      <div data-slot="email-frame" className="overflow-hidden rounded-xl border border-hairline bg-surface">
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-[18px] text-brand"
            >
              {senderName.trim().charAt(0).toUpperCase() || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] leading-5 font-medium text-text">
                {senderName} <span className="font-normal text-text-muted">&lt;{senderAddress}&gt;</span>
              </div>
              <div className="truncate text-[12px] leading-4 text-text-muted">to {recipient ?? "a customer"}</div>
            </div>
            <span className="shrink-0 text-[12px] text-text-subtle">9:41 AM</span>
          </div>
          <h3 data-slot="email-subject" className="mt-4 text-[19px] leading-[1.3] font-medium text-text [overflow-wrap:anywhere]">
            {subject || <span className="font-normal text-text-subtle">(no subject)</span>}
          </h3>
          {preheader ? (
            <p data-slot="email-preheader" className="mt-1 text-[13px] leading-5 text-text-muted [overflow-wrap:anywhere]">
              {preheader}
            </p>
          ) : null}
        </div>
        <BufferedFrame html={html} title="Email preview" autoHeight className="w-full" />
      </div>
    </div>
  );
}
