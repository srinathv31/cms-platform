"use client";

import { useId, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Per variant: hovering a blocked button leaves its fill as it is. */
const STILL = {
  default: "data-disabled:hover:bg-primary",
  /** Outline buttons here sit on `bg-surface`. */
  outline: "data-disabled:hover:bg-surface",
} as const;

export type BlockedButtonProps = Omit<
  ComponentProps<typeof Button>,
  "variant" | "disabled" | "focusableWhenDisabled" | "onClick" | "aria-describedby"
> & {
  variant?: keyof typeof STILL;
  /** Why it can't be pressed: its tooltip and its accessible description. */
  reason: string;
  /** The id of a visible line that already says `reason`. Without one, a hidden copy describes the button. */
  describedBy?: string;
};

/**
 * An action the viewer can't take, in place and greyed rather than hidden. It stays focusable (Base UI's
 * `focusableWhenDisabled`), so a keyboard user reaches it and hears why: the reason is its tooltip and its
 * accessible description. Being focusable, it is marked `aria-disabled` and `data-disabled`, not the native
 * `disabled`, so shadcn's `disabled:` classes don't match it: the `data-disabled:` ones here grey it out,
 * and keep hover and press from moving it.
 */
export function BlockedButton({ variant = "outline", reason, describedBy, className, children, ...props }: BlockedButtonProps) {
  const ownId = useId();
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              {...props}
              variant={variant}
              disabled
              focusableWhenDisabled
              aria-describedby={describedBy ?? ownId}
              className={cn(
                "data-disabled:cursor-default data-disabled:opacity-50 data-disabled:active:not-aria-[haspopup]:translate-y-0",
                STILL[variant],
                className,
              )}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      {describedBy ? null : (
        <span id={ownId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}
