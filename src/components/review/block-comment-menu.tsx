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
import type { Channel, ChannelFamily, JSONContent, Variable } from "@/domain/types";
import { cn } from "@/lib/utils";
import { commentOptions } from "./block-options";

/**
 * The keyboard (and no-hover) path to a comment on a block: a menu of the document's blocks, each named
 * by its text, under its email subject and preheader when Email is on ("Email subject": they take comments
 * as a block does). Choosing one opens the comment box on it, as the hover marker in the gutter and
 * ⌘⌥M do. In the rail, beside the Comments label. A message has no body: its menu lists its fields
 * ("Push title"), where its threads go.
 */
export function BlockCommentMenu({
  family,
  body,
  channels,
  variables,
  onPick,
  triggerRef,
}: {
  family: ChannelFamily;
  body: JSONContent;
  /** The channels that are on: a message's fields are theirs. */
  channels: readonly Channel[];
  variables: readonly Variable[];
  onPick: (blockId: string) => void;
  triggerRef: Ref<HTMLButtonElement>;
}) {
  const options = useMemo(() => commentOptions(family, body, channels, variables), [family, body, channels, variables]);
  const label = family === "message" ? "Comment on a field" : "Comment on a block";
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
                  aria-label={label}
                  className="-my-1 -mr-2 text-text-muted hover:text-text"
                />
              }
            />
          }
        >
          <MessageSquarePlus aria-hidden strokeWidth={1.75} />
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          {label}
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
