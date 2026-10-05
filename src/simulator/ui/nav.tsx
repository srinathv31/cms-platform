"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Layers, Send, Users } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: "/sim" | "/sim/customers" | "/sim/deliveries" | "/sim/notices"; label: string; icon: typeof Layers };

const ITEMS: NavItem[] = [
  { href: "/sim", label: "Offers", icon: Layers },
  { href: "/sim/customers", label: "Customers", icon: Users },
  { href: "/sim/deliveries", label: "Deliveries", icon: Send },
  { href: "/sim/notices", label: "Notices", icon: Inbox },
];

/** Coral's sidebar nav. `noticesBadge` is a server-rendered slot (the unread count). Reads the path: render it in <Suspense>. */
export function SimNav({ noticesBadge }: { noticesBadge: React.ReactNode }) {
  return <NavList pathname={usePathname()} noticesBadge={noticesBadge} />;
}

/** The nav without a path (the Suspense fallback): the same rows, none active. */
export function NavList({ pathname, noticesBadge }: { pathname: string | null; noticesBadge: React.ReactNode }) {
  const active = (href: string) =>
    pathname === null ? false : href === "/sim" ? pathname === "/sim" || pathname.startsWith("/sim/offers") : pathname.startsWith(href);
  return (
    <nav aria-label="Coral" className="flex flex-col gap-0.5 px-3 pt-2">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active(item.href) ? "page" : undefined}
          className={cn(
            "flex h-9 items-center gap-3 rounded-(--sim-rb) px-3 text-[13px] no-underline",
            active(item.href) ? "bg-(--sim-nav-active) font-medium text-(--sim-nav-on)" : "text-(--sim-nav-text) hover:bg-(--sim-nav-hover)",
          )}
        >
          <item.icon aria-hidden className="size-4" strokeWidth={1.75} />
          <span className="flex-1">{item.label}</span>
          {item.href === "/sim/notices" ? noticesBadge : null}
        </Link>
      ))}
    </nav>
  );
}
