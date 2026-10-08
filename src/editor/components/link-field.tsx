"use client";

// The format bar's link field (format-bubble.tsx swaps the bar for it: the Link button, or ⌘K).
// It takes web, email and phone links only (model/links.ts, the one link check every channel uses):
// it applies the check's normalized href, and refuses anything else with the check's reason, Apply
// shown disabled (still focusable, marked `data-disabled`). Enter applies, or says why it can't;
// Esc closes the field and goes back to the text.

import type { Editor } from "@tiptap/react";
import { Check, Unlink } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cx } from "../lib/cx";
import { checkLink } from "../model/links";
import { FOCUS_RING } from "./classes";

const ICON = { className: "size-4", strokeWidth: 1.75, "aria-hidden": true } as const;
const ACTION = cx("size-8 text-label hover:bg-hover hover:text-text", FOCUS_RING);

export function LinkField({
  editor,
  initialHref,
  hasLink,
  onClose,
}: {
  editor: Editor;
  initialHref: string;
  hasLink: boolean;
  onClose: () => void;
}) {
  const [href, setHref] = useState(initialHref);
  const [tried, setTried] = useState(false);
  const reasonId = useId();
  // What the check refuses can't be applied, and the field says why once there is something to
  // explain (text typed, or Enter on an empty field).
  const check = checkLink(href);
  const reason = !check.ok && (tried || href.trim() !== "") ? check.message : null;

  const apply = () => {
    if (!check.ok) {
      setTried(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: check.href }).run();
    onClose();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  };

  // Enter is handled here rather than by a form: an implicit submit would click the disabled Apply,
  // and Base UI cancels that click, so an empty or refused link would say nothing.
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      editor.commands.focus();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          type="text"
          inputMode="url"
          aria-label="Link address"
          aria-invalid={reason ? true : undefined}
          aria-describedby={reason ? reasonId : undefined}
          value={href}
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-8 w-64 rounded-md border-transparent bg-surface-sunken px-2.5 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0"
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Apply link"
          aria-describedby={reason ? reasonId : undefined}
          disabled={!check.ok}
          // Disabled, not hidden, and still focusable (marked `data-disabled`), so it is announced
          // with the reason; Base UI cancels its click while disabled.
          focusableWhenDisabled
          onClick={apply}
          className={cx(ACTION, "data-disabled:cursor-default data-disabled:text-text-subtle data-disabled:opacity-50 data-disabled:hover:bg-transparent")}
        >
          <Check {...ICON} />
        </Button>
        {hasLink ? (
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove link" className={ACTION} onClick={remove}>
            <Unlink {...ICON} />
          </Button>
        ) : null}
      </div>
      {reason ? (
        // As wide as the row above, never wider.
        <p id={reasonId} className="w-0 min-w-full px-1 pb-0.5 text-xs text-danger-text">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
