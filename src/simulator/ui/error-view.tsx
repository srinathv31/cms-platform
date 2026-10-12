"use client";

import { useTransition } from "react";
import Link from "next/link";
import type { RouteErrorProps } from "@/components/app-shell/route-error";
import { Btn, btnClass, PageHeader } from "./bits";
import { PageScroll } from "./page-frame";

// What Coral shows when one of its pages throws (src/app/(simulator)/error.tsx), in Coral's own look: the
// `PageError` of Stencil's frame (components/app-shell/route-error.tsx) would take Stencil's tokens inside
// Coral and send Back to library to a Stencil space. The layout above (the "Back to Stencil" strip, Coral's nav
// and the Demo pill) stays; this takes the page's place.
//
// Like Stencil's views it says one plain sentence, offers Try again and a way back, and shows the digest Next
// gives a server error; never the error's message, which can quote what was typed. Next logs the error already.

export const SIM_PAGE_FAILED = "This page didn't load";

/** Where Back to offers goes: Coral's home. */
const HOME = "/sim";

export function SimError({ error, retry }: RouteErrorProps) {
  const [pending, start] = useTransition();
  return (
    <PageScroll>
      <PageHeader
        crumbs="Coral Offers"
        title={SIM_PAGE_FAILED}
        right={
          <div className="flex shrink-0 items-center gap-2">
            <Link href={HOME} className={btnClass("secondary")}>
              Back to offers
            </Link>
            {/* Stays focusable while the route is fetched again, and a second press does nothing, as Stencil's Try again does. */}
            <Btn
              kind="primary"
              aria-disabled={pending || undefined}
              aria-busy={pending || undefined}
              onClick={() => {
                if (!pending) start(() => retry());
              }}
            >
              Try again
            </Btn>
          </div>
        }
      />
      {error.digest ? (
        <p className="m-0 text-[12px] leading-4 text-(--sim-muted) tabular-nums">
          Error ID {error.digest}
        </p>
      ) : null}
    </PageScroll>
  );
}
