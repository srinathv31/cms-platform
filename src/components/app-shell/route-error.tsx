"use client";

import { useTransition, type ComponentProps } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/primitives/page-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// What a person sees when a route throws (decision 0013). Three boundaries use it:
//   - src/app/(product)/error.tsx: a page threw. `PageError` takes the canvas; the sidebar and top bar stay.
//   - src/app/(product)/[team]/templates/[templateId]/error.tsx: a workspace tab threw. `TabError`
//     (workspace/tab-error.tsx) takes the document's cell; the header and the tab bar stay.
//   - src/app/global-error.tsx: the app frame or the root layout threw. `GlobalErrorView` is the whole page.
//
// Each says what happened in one plain sentence, offers Try again and Back to library, and shows the digest
// Next gives a server error, which is what the server's log line for it carries. Never the error's message:
// a client error's message can quote what the person typed. Next logs the error already; nothing here logs it.

/** What Next hands an error boundary (`error.tsx`, `global-error.tsx`). */
export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Re-fetches the route from the server and renders the boundary's children again. */
  retry: () => void;
}

export const PAGE_FAILED = "This page didn't load";

/** The Library of the space in the URL; outside a space, `/` (which opens the viewer's default one). */
export function useLibraryHref(): Route {
  const params = useParams<{ team?: string }>();
  const team = typeof params?.team === "string" ? params.team : null;
  return (team ? `/${team}/library` : "/") as Route;
}

/**
 * Try again: `retry` in a transition, so the button reads as busy until the route has been fetched again.
 * While busy it stays focusable (`aria-disabled`) and a second press does nothing.
 */
export function RetryButton({
  retry,
  className,
  ...props
}: { retry: () => void } & Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const [pending, start] = useTransition();
  return (
    <Button
      {...props}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      className={cn("relative", className)}
      onClick={() => {
        if (!pending) start(() => retry());
      }}
    >
      <span className={cn(pending && "invisible")}>Try again</span>
      {pending ? <Spinner aria-hidden role="presentation" className="absolute size-3.5" /> : null}
    </Button>
  );
}

/** The id the server's log line carries, for support. Only a server error has one. */
export function ErrorDigest({ digest, className }: { digest?: string; className?: string }) {
  if (!digest) return null;
  return <p className={cn("text-[12px] leading-4 text-text-muted tabular-nums", className)}>Error ID {digest}</p>;
}

/** A page that threw: the page's title says so, with Back to library and the screen's one black button, Try again. */
export function PageError({ error, retry }: RouteErrorProps) {
  const library = useLibraryHref();
  return (
    <PageHeader
      title={PAGE_FAILED}
      action={
        <>
          <Button
            variant="outline"
            size="lg"
            className="h-10 rounded-full bg-surface px-5 text-[14px]"
            nativeButton={false}
            render={<Link href={library} />}
          >
            Back to library
          </Button>
          <RetryButton retry={retry} size="lg" className="h-10 rounded-full px-5 text-[14px]" />
        </>
      }
    >
      <ErrorDigest digest={error.digest} className="mt-2" />
    </PageHeader>
  );
}

/**
 * The global error page: the app frame couldn't render, so this stands in for it. The canvas panel without the
 * sidebar, and `PageError` where a page's header would be. It needs no provider.
 */
export function GlobalErrorView(props: RouteErrorProps) {
  return (
    <main className="m-3 min-h-[calc(100svh-1.5rem)] rounded-4xl border border-hairline bg-canvas px-(--canvas-pad-x) pt-16">
      <div className="mx-auto w-full max-w-[96rem]">
        <PageError {...props} />
      </div>
    </main>
  );
}
