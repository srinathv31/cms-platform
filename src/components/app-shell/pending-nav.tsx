"use client";

import { createContext, startTransition, useCallback, useContext, useMemo, useOptimistic } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { pendingViewFor, type PendingView } from "./pending-routes";

/**
 * Pending views stand in, in development only, for the prefetch Next skips there. In production Next
 * prefetches every visible link's static shell, so a click shows the destination's skeletons at once
 * and the router alone drives navigation. In development it prefetches nothing: until the route has
 * compiled and rendered, the old page would stay frozen on screen. A plain NODE_ENV comparison, so a
 * production build folds it away; the modules that draw the views (canvas-pages.tsx and
 * workspace-page-slot.tsx) repeat it inline for the same reason.
 */
const PENDING_VIEWS = process.env.NODE_ENV === "development";

/** What a `<Link onNavigate>` receives. */
type NavigateEvent = { preventDefault: () => void };
type NavigateHandler = (event: NavigateEvent) => void;

interface NavigateOptions {
  replace?: boolean;
  scroll?: boolean;
}

interface PendingNavValue {
  /** The page on its way, while its server render is still out; null otherwise (always, in production). */
  view: PendingView | null;
  /** A Link's `onNavigate` for `href`, or undefined in production, where the Link navigates by itself. */
  link: (href: string, options?: NavigateOptions) => NavigateHandler | undefined;
  /** `router.push` (or `replace`) for code that navigates without a Link, with the pending view in development. */
  navigate: (href: string, options?: NavigateOptions) => void;
}

const PendingNavContext = createContext<PendingNavValue>({
  view: null,
  link: () => undefined,
  navigate: () => {},
});

/** The view for opening `href` now, or null to leave the navigation to Next. Reads the address at event time. */
function pendingViewNow(href: string, pending: PendingView | null): PendingView | null {
  const to = new URL(href, window.location.href);
  const here = window.location;
  // A link to the page already open is Next's refresh of that page: leave it alone, unless another page
  // is on its way, when it takes the reader back here instead.
  if (!pending && to.pathname === here.pathname && to.search === here.search) return null;
  return pendingViewFor(to.pathname, here.pathname);
}

/**
 * Shows where a click is going before the development server answers.
 *
 * A wired link starts the navigation itself, inside one transition with an optimistic `view`: the
 * optimistic value renders at once (the canvas shows the destination's skeleton, drawn from the same
 * frame and fallbacks as the page, and the sidebar lights its item), and React drops it in the same
 * commit that mounts the real page, because the router's update rides the same transition. There is no
 * frame between the two, so the page's own skeletons take over in place.
 */
export function PendingNavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [view, setView] = useOptimistic<PendingView | null>(null);

  const go = useCallback(
    (href: string, next: PendingView | null, options: NavigateOptions) => {
      startTransition(() => {
        if (next) setView(next);
        if (options.replace) router.replace(href as Route, { scroll: options.scroll });
        else router.push(href as Route, { scroll: options.scroll });
      });
    },
    [router, setView],
  );

  const link = useCallback(
    (href: string, options: NavigateOptions = {}): NavigateHandler | undefined => {
      if (!PENDING_VIEWS) return undefined;
      return (event) => {
        const next = pendingViewNow(href, view);
        if (!next) return;
        event.preventDefault();
        go(href, next, options);
      };
    },
    [view, go],
  );

  const navigate = useCallback(
    (href: string, options: NavigateOptions = {}) => {
      go(href, PENDING_VIEWS ? pendingViewNow(href, view) : null, options);
    },
    [view, go],
  );

  const value = useMemo(() => ({ view, link, navigate }), [view, link, navigate]);
  return <PendingNavContext.Provider value={value}>{children}</PendingNavContext.Provider>;
}

export function usePendingNav() {
  return useContext(PendingNavContext);
}
