import Link from "next/link";
import { Component } from "lucide-react";
import { LinkPending } from "@/components/primitives/link-pending";

/**
 * Top of the sidebar: the product's mark and name, linking home ("/" sends the viewer to their own space).
 * Same row geometry as the team switcher below it, so the mark sits over the team icon and the names align.
 */
export function HomeLink() {
  return (
    <Link
      href="/"
      aria-label="Stencil home"
      className="flex h-12 items-center gap-3 rounded-xl px-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Component aria-hidden strokeWidth={1.75} className="size-[18px]" />
      </span>
      <span className="font-display text-[22px] leading-none tracking-[-0.01em] text-text">Stencil</span>
      <LinkPending className="ml-auto" />
    </Link>
  );
}
