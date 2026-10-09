"use client";

import "./globals.css";
import { GlobalErrorView, type RouteErrorProps } from "@/components/app-shell/route-error";
import { fontVariables } from "@/styles/fonts";

// The root layout, or the app frame in (product)/layout.tsx, threw. This replaces the root layout, so it
// renders its own document with the app's styles and fonts, and none of its providers.
export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="en" className={`${fontVariables} h-full`}>
      <body className="min-h-full">
        <title>This page didn&apos;t load · Stencil</title>
        <GlobalErrorView {...props} />
      </body>
    </html>
  );
}
