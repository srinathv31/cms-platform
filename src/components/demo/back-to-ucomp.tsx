"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";

// "Back to UCOMP" returns to the page the simulator was opened from (the Demo pill remembers it for the
// tab), or to "/" when there is none: a fresh tab, a shared link, storage off.

const KEY = "ucomp:sim-return";

/** Only a same-origin UCOMP path: never protocol-relative, never back into the simulator. */
function usable(path: string | null): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//") && !/^\/sim(\/|\?|$)/.test(path);
}

/** Called by the Demo pill as it opens the simulator. */
export function rememberSimReturn() {
  try {
    const path = `${window.location.pathname}${window.location.search}`;
    if (usable(path)) window.sessionStorage.setItem(KEY, path);
  } catch {
    // Storage off: Back to UCOMP goes to "/".
  }
}

function readReturn(): string {
  try {
    const path = window.sessionStorage.getItem(KEY);
    return usable(path) ? path : "/";
  } catch {
    return "/";
  }
}

const subscribe = () => () => {};

export function BackToUcomp() {
  const router = useRouter();
  const href = useSyncExternalStore(subscribe, readReturn, () => "/");
  return (
    <Link
      href={href as Route}
      onClick={(event) => {
        // Next keeps this layout alive between visits, so read the place again at click time.
        const fresh = readReturn();
        if (fresh === href || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        router.push(fresh as Route);
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-text px-3.5 text-[13px] font-medium text-surface outline-none hover:bg-text/90 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft aria-hidden strokeWidth={1.75} className="size-4" />
      Back to UCOMP
    </Link>
  );
}
