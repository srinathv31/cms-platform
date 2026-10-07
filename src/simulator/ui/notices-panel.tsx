"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import Link from "next/link";
import { markNoticesRead } from "@/simulator/actions";
import type { SimNoticeView } from "@/simulator/types";
import { cn } from "@/lib/utils";
import { Btn, Mono, Panel, Pill, btnClass, type Tone } from "./bits";
import { dayLabel, withKeys } from "./format";

const KIND: Record<SimNoticeView["kind"], { title: (n: SimNoticeView) => string; tone: Tone }> = {
  new_version: { title: (n) => `New version: v${n.versionNumber}`, tone: "info" },
  sunset_scheduled: { title: (n) => `Sunset scheduled for v${n.versionNumber}`, tone: "warn" },
  revoked: { title: (n) => `v${n.versionNumber} revoked`, tone: "bad" },
};

/**
 * Coral's notice inbox (UCOMP's outbox for this consumer). Each unread notice can be marked read; the
 * sidebar badge counts what is still unread.
 */
export function NoticesPanel({
  notices,
  offerNames,
  title = "Notices from Stencil",
  footer,
}: {
  notices: SimNoticeView[];
  offerNames: Record<string, string>;
  title?: string;
  footer?: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const unread = notices.filter((n) => !n.read).map((n) => n.id);

  // Marking a notice read removes the button that has focus. Focus goes to the next unread notice's
  // button (or the one before it), and to the list when none is left, once the new notices arrive.
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    (target === "list" ? listRef.current : document.getElementById(`mark-read-${target}`))?.focus();
  }, [notices]);

  const markRead = (ids: string[], after: string) => {
    focusAfter.current = after;
    startTransition(async () => {
      const result = await markNoticesRead({ noticeIds: ids });
      if (!result.ok) focusAfter.current = null;
      setError(result.ok ? null : result.reason);
    });
  };
  const nextUnread = (id: string): string => {
    const i = unread.indexOf(id);
    return unread[i + 1] ?? unread[i - 1] ?? "list";
  };

  return (
    <Panel
      title={title}
      label={title}
      right={
        unread.length > 0 ? (
          <Btn className="h-7" disabled={pending} onClick={() => markRead(unread, "list")}>
            Mark all read
          </Btn>
        ) : null
      }
    >
      {notices.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[13px] text-(--sim-muted)">No notices.</p>
      ) : (
        <ul ref={listRef} tabIndex={-1} className="m-0 list-none divide-y divide-(--sim-line) p-0 outline-none">
          {notices.map((n) => (
            <li key={n.id} className="flex items-start gap-4 px-4 py-3.5">
              <span
                aria-label={n.read ? "Read" : "Unread"}
                role="img"
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "border border-(--sim-line)" : "bg-(--sim-accent)")}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-[13px] font-semibold">{KIND[n.kind].title(n)}</p>
                  <Pill tone={KIND[n.kind].tone}>{n.templateName}</Pill>
                  <Mono className="text-(--sim-muted)">{n.templateId}</Mono>
                </div>
                <p className="m-0 mt-1 text-[13px] text-(--sim-muted)">{n.message}</p>
                {n.lines.length > 0 ? (
                  <ul className="m-0 mt-1.5 list-disc pl-4 text-[12px] text-(--sim-muted)">
                    {n.lines.map((line, i) => (
                      <li key={i}>{withKeys(line)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-[12px] text-(--sim-muted)">{dayLabel(n.createdAt)}</span>
                <span className="flex items-center gap-1.5">
                  {n.offerIds.map((id) => (
                    <Link key={id} href={`/sim/offers/${id}` as Route} className={btnClass("secondary", "h-7")}>
                      {n.offerIds.length > 1 ? `Review ${offerNames[id] ?? id}` : "Review"}
                    </Link>
                  ))}
                  {n.read ? null : (
                    <Btn kind="ghost" id={`mark-read-${n.id}`} className="h-7" disabled={pending} onClick={() => markRead([n.id], nextUnread(n.id))}>
                      Mark read
                    </Btn>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="m-0 border-t border-(--sim-line) px-4 py-2.5 text-[13px] text-(--sim-bad)">{error}</p> : null}
      {footer}
    </Panel>
  );
}
