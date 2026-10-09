"use client";

import { PageError, type RouteErrorProps } from "@/components/app-shell/route-error";

// A page inside the app frame threw: its error takes the canvas, and the sidebar and top bar stay. The frame
// is this group's layout, which this boundary doesn't cover: global-error.tsx catches a failure there.
export default function ProductError(props: RouteErrorProps) {
  return <PageError {...props} />;
}
