"use client";

// Who gets an Escape pressed while the rail is open: the rail (it puts the preview away), or something
// else that is open and uses the key itself. Each such thing is a claim in the registry below, so a
// reader finds every one in one place and a new overlay adds one rather than another check in the
// rail's key handler. Asked in the capture phase, before the claimant handles the key and closes.
//
// The claims read the page, not state: Base UI's popups and TipTap's menus are not ours to register.
// If either changes its roles or attributes, the matching claim here is the only place to follow it.

import { useEffect, useRef } from "react";
import type { FocusTargets } from "../session/focus-targets";

/** What a claim may need to know besides the element the key was pressed on. */
export interface EscapeContext {
  targets: FocusTargets;
  /** What the template name field said when it last got focus: an Escape there with the same text has no edit to put back. */
  nameAtFocus: string | null;
}

/** Whether something is open (or mid-edit) that will use this Escape itself. */
export type EscapeClaim = (
  target: Element | null,
  context: EscapeContext,
) => boolean;

export interface EscapeClaims {
  /** Adds a claim under `name` (shown in tests and failures); the returned function takes it out. */
  add: (name: string, claim: EscapeClaim) => () => void;
  /** The names of the claims, in the order they are asked. */
  names: () => string[];
  /** Whether any claim holds for an Escape pressed on `target`. */
  spokenFor: (target: Element | null, context: EscapeContext) => boolean;
}

export function createEscapeClaims(): EscapeClaims {
  const claims = new Map<string, EscapeClaim>();
  return {
    add(name, claim) {
      claims.set(name, claim);
      return () => {
        if (claims.get(name) === claim) claims.delete(name);
      };
    },
    names: () => [...claims.keys()],
    spokenFor: (target, context) =>
      [...claims.values()].some((claim) => claim(target, context)),
  };
}

/**
 * Whether `target` is the template name in the header (name-field.tsx), which registers itself as a
 * focus target. Its own Escape puts the old name back and leaves the field, so an Escape there is
 * spoken for only while the name is mid-edit; with nothing to put back it is just a way out of the
 * field, and the preview closes.
 */
export function inNameField(
  targets: FocusTargets,
  target: Element | null,
): boolean {
  const name = targets.get("name");
  return name !== null && target !== null && name.contains(target);
}

/**
 * Something above the document that takes the first Escape: a menu, a popover or a dialog. Base UI's
 * popups and the sample-set editor are `menu`, `listbox` or `dialog` for as long as they are open.
 */
const OPEN_POPUP = '[role="menu"], [role="listbox"], [role="dialog"]';

/** The rail's own claims: the editor's menus, a name mid-edit, and any open popup. */
export const railEscapeClaims = createEscapeClaims();

// The editor's `/` menu and `{{` picker point the editor at their list with `aria-controls` while they
// are open. The editor closes the menu inside its own key handler, and React has unmounted it by the
// time a bubbling listener runs: only the capture phase can still see it.
railEscapeClaims.add("editor-menu", (target) =>
  Boolean(target?.closest(".ProseMirror")?.hasAttribute("aria-controls")),
);

railEscapeClaims.add(
  "name-mid-edit",
  (target, { targets, nameAtFocus }) =>
    inNameField(targets, target) &&
    targets.get("name")?.value.trim() !== nameAtFocus,
);

// Only one on screen: a route kept mounted but hidden (`<Activity>`) can still hold an open dialog, such as
// the Library's New template, left open by the import or starter that navigated away from it.
railEscapeClaims.add("open-popup", () =>
  [...document.querySelectorAll(OPEN_POPUP)].some(
    (el) => el.getClientRects().length > 0,
  ),
);

/**
 * While `active`, calls `onUnclaimed` for an Escape that nothing else wants: no claim in
 * `railEscapeClaims` held when it was pressed, and, outside the document and the name field, no handler
 * used the key (it is `defaultPrevented`). ProseMirror swallows every Escape, so there `defaultPrevented`
 * means nothing; the name field always prevents it, to leave the field, which is why the claims ask
 * about it in the capture phase.
 *
 * Also keeps what the name field said when it got focus, which the name's claim compares against.
 * `onUnclaimed` is a dependency: pass one that is stable while nothing it reads has changed.
 */
export function useUnclaimedEscape(
  targets: FocusTargets,
  active: boolean,
  onUnclaimed: (event: KeyboardEvent) => void,
) {
  const nameAtFocus = useRef<string | null>(null);

  useEffect(() => {
    const note = (el: Element | null) => {
      const name = targets.get("name");
      if (name !== null && el === name) nameAtFocus.current = name.value.trim();
    };
    note(document.activeElement);
    const onFocusIn = (event: FocusEvent) =>
      note(event.target instanceof Element ? event.target : null);
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [targets]);

  useEffect(() => {
    if (!active) return;
    let spokenFor = false;
    const onCapture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target instanceof Element ? event.target : null;
      spokenFor = railEscapeClaims.spokenFor(target, {
        targets,
        nameAtFocus: nameAtFocus.current,
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || spokenFor) return;
      const target = event.target instanceof Element ? event.target : null;
      const inDocument = target?.closest(".ProseMirror") != null;
      if (
        event.defaultPrevented &&
        !inDocument &&
        !inNameField(targets, target)
      )
        return;
      onUnclaimed(event);
    };
    document.addEventListener("keydown", onCapture, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onCapture, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, targets, onUnclaimed]);
}
