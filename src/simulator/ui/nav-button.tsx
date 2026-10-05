"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Btn, type BtnKind } from "./bits";

/** A button that goes to another page (the step buttons: "Link template", "Relink to v3", "Change template"). */
export function NavButton({ href, kind = "secondary", className, children }: { href: string; kind?: BtnKind; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Btn kind={kind} className={className} onClick={() => router.push(href as Route)}>
      {children}
    </Btn>
  );
}
