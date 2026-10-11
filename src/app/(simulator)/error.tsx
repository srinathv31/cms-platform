"use client";

import type { RouteErrorProps } from "@/components/app-shell/route-error";
import { SimError } from "@/simulator/ui/error-view";

// A page under /sim threw: Coral's error takes the page, and the layout's strip, nav and Demo pill stay. The
// layout is this group's, which this boundary doesn't cover: global-error.tsx catches a failure there. It goes
// back to /sim, not to a Stencil space's Library, which is what (product)/error.tsx's view offers.
export default function SimulatorError(props: RouteErrorProps) {
  return <SimError {...props} />;
}
