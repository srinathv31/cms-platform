"use client";

import { useMemo, type Ref } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { JSONContent, Variable } from "@/domain/types";
import { cn } from "@/lib/utils";
import { blockOptions } from "./block-options";

/**
 * The keyboard (and no-hover) path to a comment on a block: a menu of the document's blocks, each named
 * by its text. Choosing one opens the comment box on that block, as the hover marker in the gutter and
 * ⌘⌥M do. In the rail, beside the Comments label.
 */
export function BlockCommentMenu({
  body,
  variables,
  onPick,
  triggerRef,
}: {
  body: JSONContent;
  variables: readonly Variable[];
  onPick: (blockId: string) => void;
  triggerRef: Ref<HTMLButtonElement>;
}) {
  const options = useMemo(() => blockOptions(body, variables), [body, variables]);
  if (options.length === 0) return null;
  return (
    <DropdownMenu>
      {/* The styled tooltip (shadcn's, as the selection bubble wears it), not a native title: one look for every hint.
          The tooltip trigger wraps the menu trigger so the one button is both; the ref and the label ride on the button. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  ref={triggerRef}
                  variant="ghost"
                  size="icon"
                  aria-label="Comment on a block"
                  className="-my-1 -mr-2 text-text-muted hover:text-text"
                />
              }
            />
          }
        >
          <MessageSquarePlus aria-hidden strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          Comment on a block
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-80 w-72">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => onPick(option.id)}
            className={cn("text-[14px]", option.heading && "font-medium")}
          >
            <span className="min-w-0 truncate">{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
