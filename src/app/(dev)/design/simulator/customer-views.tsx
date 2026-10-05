"use client";

import { Battery, ChevronLeft, Download, Mail, Printer, Signal, Star, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { disclosureLines, fullName, type Customer, type ViewMode } from "./data";

/*
 * What the customer sees. Coral shows UCOMP's rendered output inside its own app, inbox and viewer.
 * These are light surfaces in every variant, since the disclosure is the customer's, not the console's.
 */

function Body({ c, version, small }: { c: Customer; version: 2 | 3; small?: boolean }) {
  const d = disclosureLines(c, version);
  return (
    <div className={cn("text-[#1c1f24]", small ? "text-[12px] leading-[1.5]" : "text-[13px] leading-[1.55]")}>
      <p className="break-words">{d.greeting}</p>
      <h4 className="mt-3 text-[11px] font-semibold tracking-wider text-[#5b6472] uppercase">Offer details</h4>
      <p className="mt-1 break-words">{d.offer}</p>
      <h4 className="mt-3 text-[11px] font-semibold tracking-wider text-[#5b6472] uppercase">Rates and fees</h4>
      <dl className="mt-1 divide-y divide-[#e6e9ee] border-y border-[#e6e9ee]">
        {d.rates.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1">
            <dt className="text-[#5b6472]">{k}</dt>
            <dd className="m-0 tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-3 text-[11px] font-semibold tracking-wider text-[#5b6472] uppercase">Legal notices</h4>
      <p className="mt-1 text-[#5b6472]">{d.legal}</p>
    </div>
  );
}

export function PhoneView({ c, version, accent }: { c: Customer; version: 2 | 3; accent?: boolean }) {
  return (
    <div className="mx-auto w-[286px] rounded-[40px] border-[7px] border-[#12151a] bg-[#12151a] shadow-[0_20px_44px_-20px_rgb(0_0_0/0.5)]">
      <div className="relative h-[560px] overflow-hidden rounded-[32px] bg-white">
        <div className="absolute top-2 left-1/2 h-[18px] w-20 -translate-x-1/2 rounded-full bg-[#12151a]" />
        <div className="flex h-9 items-end justify-between px-5 pb-1 text-[11px] font-semibold text-[#12151a]">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <Signal className="size-3" strokeWidth={2} />
            <Wifi className="size-3" strokeWidth={2} />
            <Battery className="size-3.5" strokeWidth={2} />
          </span>
        </div>
        <div className="flex h-11 items-center gap-1 border-b border-[#e6e9ee] px-3">
          <ChevronLeft className="size-5 text-[#12151a]" strokeWidth={1.75} />
          <span className="flex-1 text-center text-[14px] font-semibold text-[#12151a]">Offer terms</span>
          <span className={cn("grid size-6 place-items-center rounded-full text-white", accent ? "bg-(--s-accent) text-(--s-accent-text)" : "bg-[#f0603a]")}>
            <Star className="size-3" strokeWidth={2} fill="currentColor" />
          </span>
        </div>
        <div className="overflow-hidden px-4 pt-4">
          <p className="text-[11px] font-semibold tracking-wider text-[#f0603a] uppercase">Spring Travel Rewards</p>
          <h3 className="mt-1 text-[18px] leading-[1.2] font-semibold text-[#12151a]">Your offer terms</h3>
          <div className="mt-3">
            <Body c={c} version={version} small />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
      </div>
    </div>
  );
}

export function InboxView({ c, version, narrow }: { c: Customer; version: 2 | 3; narrow?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#d9dde4] bg-white text-[#1c1f24] shadow-[0_12px_30px_-18px_rgb(0_0_0/0.35)]">
      <div className="flex h-8 items-center gap-1.5 border-b border-[#e6e9ee] bg-[#f4f5f7] px-3">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 flex items-center gap-1.5 text-[11px] text-[#5b6472]">
          <Mail className="size-3" strokeWidth={1.75} /> Inbox
        </span>
      </div>
      <div className={cn("grid", narrow ? "grid-cols-1" : "grid-cols-[11rem_minmax(0,1fr)]")}>
        {narrow ? null : (
          <ul className="m-0 list-none border-r border-[#e6e9ee] bg-[#fafbfc] p-0 text-[12px]">
            <li className="border-l-2 border-[#f0603a] bg-white px-3 py-2.5">
              <p className="truncate font-semibold">Coral Offers</p>
              <p className="truncate text-[#5b6472]">Your Spring Travel Rewards terms</p>
            </li>
            <li className="border-t border-[#e6e9ee] px-3 py-2.5 text-[#5b6472]">
              <p className="truncate">Northside Bank</p>
              <p className="truncate">Your January statement</p>
            </li>
            <li className="border-t border-[#e6e9ee] px-3 py-2.5 text-[#5b6472]">
              <p className="truncate">Maple Street Cafe</p>
              <p className="truncate">Receipt for order 3381</p>
            </li>
          </ul>
        )}
        <div className="min-w-0 p-4">
          <h3 className="m-0 text-[15px] leading-snug font-semibold break-words">Your Spring Travel Rewards terms, {c.first}</h3>
          <p className="mt-1 mb-0 text-[11px] break-all text-[#5b6472]">
            From Coral Offers &lt;offers@coral.example&gt; to {c.email}
          </p>
          <div className="mt-3 border-t border-[#e6e9ee] pt-3">
            <Body c={c} version={version} small />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PdfView({ c, version, width = 340 }: { c: Customer; version: 2 | 3; width?: number }) {
  const d = disclosureLines(c, version);
  return (
    <div className="rounded-lg bg-[#5c6370] p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-white/85">
        <span className="truncate">spring-travel-rewards-terms.pdf</span>
        <span className="flex shrink-0 items-center gap-2">
          1 / 1 <Printer className="size-3.5" strokeWidth={1.75} /> <Download className="size-3.5" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mx-auto flex flex-col bg-white p-7 text-[#1c1f24] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.6)]" style={{ width, aspectRatio: "8.5 / 11" }}>
        <div className="flex items-baseline justify-between border-b border-[#1c1f24] pb-2">
          <span className="text-[13px] font-semibold tracking-wide">CORAL</span>
          <span className="text-[9px] text-[#5b6472]">Cardmember: {fullName(c)}</span>
        </div>
        <h3 className="mt-4 mb-0 font-serif text-[18px] leading-tight font-normal">{d.title}</h3>
        <div className="mt-3">
          <Body c={c} version={version} small />
        </div>
        <p className="mt-auto pt-6 text-center text-[9px] text-[#5b6472]">Page 1 of 1</p>
      </div>
    </div>
  );
}

export function CustomerView({
  mode,
  c,
  version,
  narrow,
  accent,
}: {
  mode: ViewMode;
  c: Customer;
  version: 2 | 3;
  narrow?: boolean;
  accent?: boolean;
}) {
  if (mode === "phone") return <PhoneView c={c} version={version} accent={accent} />;
  if (mode === "inbox") return <InboxView c={c} version={version} narrow={narrow} />;
  return <PdfView c={c} version={version} width={narrow ? 300 : 340} />;
}
