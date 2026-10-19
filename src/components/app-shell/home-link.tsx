import Link from "next/link";
import { HEADER_LOGO_VARIANT } from "@/components/brand/logo-config";
import {
  StencilLogo,
  type StencilLogoVariant,
} from "@/components/brand/stencil-logo";
import { LinkPending } from "@/components/primitives/link-pending";

/**
 * Top of the sidebar: the product's logo, linking home ("/" sends the viewer to their own space).
 * Same row geometry as the team switcher below it, so the mark sits over the team icon and the names align.
 * The logo's variant is `HEADER_LOGO_VARIANT`; the logo lab passes its own.
 */
export function HomeLink({
  variant = HEADER_LOGO_VARIANT,
}: {
  variant?: StencilLogoVariant;
}) {
  return (
    <Link
      href="/"
      aria-label="Stencil home"
      className="flex h-12 items-center gap-3 rounded-xl px-2 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <StencilLogo variant={variant} size="nav" />
      <LinkPending className="ml-auto" />
    </Link>
  );
}
