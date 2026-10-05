"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import type { Route } from "next";
import { m } from "motion/react";
import { Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fadeRise } from "@/components/motion/presets";
import { ROLE_LABEL } from "@/domain/access";
import type { SidebarCardModel } from "@/domain/access-types";
import { formatShortDate } from "@/domain/dates";

const EVENT = "ucomp:card-dismissed";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}


interface CardContent {
  title: string;
  /** One or two quiet lines. */
  lines: string[];
  action?: { label: string; href: string };
}

/** What each card says. Dates are demo-clock instants, shown in UTC like everywhere else. */
function contentOf(card: SidebarCardModel): CardContent {
  switch (card.kind) {
    case "access_requests":
      return {
        title: card.count === 1 ? "Access request pending" : "Access requests pending",
        lines: [
          card.count === 1
            ? `${card.firstName} asked for ${ROLE_LABEL[card.role]} access.`
            : `${card.firstName} and ${card.count - 1} other${card.count === 2 ? "" : "s"} asked for access.`,
        ],
        action: { label: "Review", href: `/${card.teamSlug}/settings/access-requests` },
      };
    case "recert_due":
      return {
        title: "Recertification due",
        lines: [`${card.label} · due ${formatShortDate(card.dueAt)}`, card.progressLabel],
        action: { label: "Review", href: `/${card.teamSlug}/settings/recertification` },
      };
    case "my_request":
      return {
        title: "Your request is waiting",
        lines: [
          `${ROLE_LABEL[card.role]} access to ${card.teamName}`,
          card.adminName
            ? `Sent ${formatShortDate(card.createdAt)} · waiting on ${card.adminName}`
            : `Sent ${formatShortDate(card.createdAt)}`,
        ],
      };
  }
}

/**
 * The one dismissible card above Settings and Help (Flow-style). One per space, by priority: access
 * requests waiting, then a recertification due (both for a Team Admin), then the viewer's own pending
 * request when they have no space yet. Dismissal is remembered in localStorage by the card's id, which
 * changes when its content does (a new request brings it back).
 * Until the client has read localStorage the card stays hidden. It floats in the free space
 * above the footer (absolutely positioned against it), so nothing moves when it appears.
 */
export function SidebarCard({ card }: { card: SidebarCardModel }) {
  const key = `ucomp:dismissed:${card.id}`;
  const { title, lines, action } = contentOf(card);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(key),
    () => true,
  );

  if (dismissed) return null;

  return (
    <m.div
      {...fadeRise}
      className="absolute inset-x-3 bottom-[calc(100%+0.75rem)] rounded-xl border border-hairline bg-surface p-4"
      data-slot="sidebar-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[15px] leading-6 font-medium">{title}</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          className="-mt-0.5 -mr-1.5 text-text-muted"
          onClick={() => {
            try {
              window.localStorage.setItem(key, "1");
            } catch {
              /* private mode: dismiss for this page view only */
            }
            window.dispatchEvent(new Event(EVENT));
          }}
        >
          <Minus aria-hidden strokeWidth={1.75} />
        </Button>
      </div>
      <div className="mt-0.5 text-sm leading-5 text-text-muted">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {action ? (
        <Button
          variant="secondary"
          size="lg"
          className="mt-3 rounded-lg px-3.5 font-medium"
          nativeButton={false}
          render={<Link href={action.href as Route} />}
        >
          {action.label}
        </Button>
      ) : null}
    </m.div>
  );
}
