"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { takeJustCreated } from "./just-created";
import { useWorkspaceSession } from "./session/workspace-session";

/** The most the server accepts (parse-patch.ts: 1 to 120 characters). */
const MAX_NAME_LENGTH = 120;

// The title, in display type. The field looks like the title: no box until it is hovered or focused.
// The mirror and the textarea share these, so the textarea grows with its text and a long name wraps
// onto a second line instead of being cut off.
const TYPE = "col-start-1 row-start-1 min-w-0 px-2 py-0.5 font-[inherit] text-[length:inherit] leading-[inherit] tracking-[inherit] wrap-break-word whitespace-pre-wrap text-pretty";

/**
 * The template name, as the page title.
 *
 * - Not editable (the version isn't an open draft, or the viewer can't edit): plain text.
 * - Editable: a field that saves through the workspace's autosave session as the author types.
 *   Enter moves into the document, Esc puts the old name back and leaves the field (unless the rail is open:
 *   that Esc closes the rail and focus stays), and clearing it never saves an empty name (it reverts on blur).
 * - Arriving at a template just made from a starter (`createTemplate` leaves a one-shot cookie, see
 *   `just-created.ts`): the name is focused with all of its text selected, so the first thing the
 *   author types replaces it. The address is already the template's own: nothing to drop from it.
 */
export function NameField({ name, editable }: { name: string; editable: boolean }) {
  if (!editable) {
    return (
      <h1 className="display-lg min-w-0 wrap-break-word text-pretty text-text" title={name}>
        {name}
      </h1>
    );
  }
  return <EditableName name={name} />;
}

function EditableName({ name }: { name: string }) {
  const session = useWorkspaceSession();
  const { templateId } = useParams<{ templateId?: string }>();

  const field = useRef<HTMLTextAreaElement>(null);
  // The textarea is uncontrolled: its DOM value is the source of truth for as long as the author is
  // typing, and nothing React renders can write over it (a re-render with stale state, a remount's
  // initial value). This state only feeds the hidden mirror that sizes the field, so a stale value
  // costs one frame of height at worst. The field is written to by hand only in `show`: Esc, an
  // emptied field going back to its starting name, and the trim when the field is left.
  const [mirror, setMirror] = useState(name);
  /** The name as it was when the field got focus: what Esc goes back to. */
  const startName = useRef(name);
  /** The last non-empty name handed to autosave: what an emptied field falls back to. */
  const lastGood = useRef(name);

  // A new template: focus the name with all of it selected. The flag is taken as it is read, so this
  // happens once, on arrival; a re-run of the effect (Strict Mode, the page shown again after Back and
  // Forward) finds nothing to take. Nothing here touches the address or the router.
  useEffect(() => {
    if (!takeJustCreated(templateId)) return;
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [templateId]);

  function show(next: string) {
    const el = field.current;
    if (el) el.value = next;
    setMirror(next);
  }

  function change(event: ChangeEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    // Pasting from a document can bring line breaks along. A name is one line.
    if (/[\r\n]/.test(el.value)) {
      const caret = el.value.slice(0, el.selectionStart).replace(/\s*[\r\n]+\s*/g, " ").length;
      el.value = el.value.replace(/\s*[\r\n]+\s*/g, " ");
      el.setSelectionRange(caret, caret);
    }
    setMirror(el.value);
    const trimmed = el.value.trim();
    if (!trimmed) return; // Nothing to save while the author is mid-retype.
    lastGood.current = trimmed;
    session.save({ name: trimmed });
  }

  function revert() {
    const original = startName.current;
    show(original);
    if (lastGood.current !== original) {
      lastGood.current = original;
      session.save({ name: original });
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      session.focusDocument();
    } else if (event.key === "Escape") {
      event.preventDefault();
      revert();
      // With the rail open (the Original view after an import, the preview) the same Esc puts it away
      // (content/rail.tsx), and the author stays in the name; otherwise Esc is the way out of the field.
      if (!session.getPreview().open && !session.getRailOpen()) event.currentTarget.blur();
    }
  }

  function blur(event: React.FocusEvent<HTMLTextAreaElement>) {
    // An emptied field goes back to the name it started with; otherwise what is on screen is what
    // is saved, trimmed.
    if (!event.currentTarget.value.trim()) revert();
    else show(lastGood.current);
  }

  return (
    <h1 className="display-lg min-w-0 text-text">
      <span className="relative -my-0.5 -ml-2 grid w-[calc(100%+0.5rem)] min-w-0">
        {/* Mirrors the text so the grid cell, and so the field, is as tall as the wrapped name. */}
        <span aria-hidden className={cn(TYPE, "invisible")}>
          {mirror}
          {"\u200b"}
        </span>
        <textarea
          ref={field}
          defaultValue={name}
          rows={1}
          maxLength={MAX_NAME_LENGTH}
          aria-label="Template name"
          spellCheck={false}
          autoComplete="off"
          onChange={change}
          onKeyDown={keyDown}
          onFocus={() => {
            startName.current = lastGood.current;
          }}
          onBlur={blur}
          className={cn(
            TYPE,
            "resize-none overflow-hidden rounded-lg bg-transparent text-text outline-none",
            "transition-colors duration-(--dur-fast) hover:bg-hover focus:bg-surface focus:ring-1 focus:ring-hairline",
          )}
        />
      </span>
    </h1>
  );
}
