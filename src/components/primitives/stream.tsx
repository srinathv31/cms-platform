import { Suspense, ViewTransition } from "react";

/**
 * The one streaming boundary used across the app (no loading.tsx anywhere).
 * Suspense + ViewTransition: the skeleton exits, the content enters with a 2px rise.
 * Skeletons must match the final geometry so there is zero layout shift.
 * It catches no errors: a throw inside goes to the route's error.tsx (docs/decisions/0013).
 */
export function Stream({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <ViewTransition exit="stream-exit" default="none">
          {fallback}
        </ViewTransition>
      }
    >
      <ViewTransition enter="stream-enter" default="none">
        {children}
      </ViewTransition>
    </Suspense>
  );
}
