"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import type { Route } from "next";
import { m } from "motion/react";
import { Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fadeRise } from "@/components/motion/presets";
import type { RecertCard } from "@/server/queries/spaces";

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

/**
 * The one dismissible card above Settings and Help (Flow-style).
 * For a Team Admin with an open recertification. Dismissal is remembered in localStorage.
 * Until the client has read localStorage the card stays hidden. It floats in the free space
 * above the footer (absolutely positioned against it), so nothing moves when it appears.
 */
export function SidebarCard({ recert, teamSlug }: { recert: RecertCard; teamSlug: string }) {
  const key = `ucomp:dismissed:${recert.id}`;
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
        <h2 className="text-[15px] leading-6 font-medium">Recertification due</h2>
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
      <p className="mt-0.5 text-sm leading-5 text-text-muted">
        {recert.label} · due {recert.dueLabel}
      </p>
      <Button
        variant="secondary"
        size="lg"
        className="mt-3 rounded-lg px-3.5 font-medium"
        nativeButton={false}
        render={<Link href={`/${teamSlug}/settings/recertification` as Route} />}
      >
        Review
      </Button>
    </m.div>
  );
}
