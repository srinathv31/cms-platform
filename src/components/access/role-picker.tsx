"use client";

import { useRef } from "react";
import { ROLE_LABEL } from "@/domain/access";
import type { RequestableRole } from "@/domain/access-types";
import { cn } from "@/lib/utils";

// The app's one segmented style (a white 32px track, `bg-selected` under the chosen segment), the same
// look as `preview/controls.tsx`. Semantically a radio group: exactly one role is always chosen, Tab
// lands on the chosen one and the arrow keys move the choice.
const TRACK = "inline-flex h-8 items-center gap-0.5 rounded-lg border border-hairline bg-surface p-0.5";
const SEGMENT =
  "inline-flex h-6 min-w-0 items-center justify-center rounded-md px-3 text-[13px] font-medium whitespace-nowrap text-text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-selected aria-checked:text-text aria-checked:hover:bg-selected";

/** Viewer, Author or Approver. There is always one chosen. */
export function RolePicker({
  roles,
  value,
  onChange,
  labelledBy,
  className,
}: {
  roles: readonly RequestableRole[];
  value: RequestableRole;
  onChange: (role: RequestableRole) => void;
  labelledBy: string;
  className?: string;
}) {
  const buttons = useRef(new Map<RequestableRole, HTMLButtonElement | null>());

  const pick = (index: number) => {
    const role = roles[(index + roles.length) % roles.length];
    if (!role) return;
    onChange(role);
    buttons.current.get(role)?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={cn("w-fit", TRACK, className)}>
      {roles.map((role, index) => {
        const checked = role === value;
        return (
          <button
            key={role}
            ref={(el) => {
              buttons.current.set(role, el);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(role)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                pick(index + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                pick(index - 1);
              }
            }}
            className={SEGMENT}
          >
            {ROLE_LABEL[role]}
          </button>
        );
      })}
    </div>
  );
}
