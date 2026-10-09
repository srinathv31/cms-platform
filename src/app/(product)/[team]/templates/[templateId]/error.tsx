"use client";

import type { RouteErrorProps } from "@/components/app-shell/route-error";
import { TabError } from "@/components/workspace/tab-error";

// A workspace tab threw: its error takes the document's cell, and the layout's header and tab bar stay. The
// layout itself is above this boundary: a failure there goes to (product)/error.tsx.
export default function TemplateError(props: RouteErrorProps) {
  return <TabError {...props} />;
}
