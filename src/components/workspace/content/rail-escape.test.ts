// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createFocusTargets } from "../session/focus-targets";
import {
  createEscapeClaims,
  inNameField,
  railEscapeClaims,
  type EscapeContext,
} from "./rail-escape";

afterEach(() => {
  document.body.innerHTML = "";
});

function element<T extends HTMLElement>(
  tag: string,
  attributes: Record<string, string> = {},
  parent: HTMLElement = document.body,
): T {
  const el = document.createElement(tag) as T;
  for (const [name, value] of Object.entries(attributes))
    el.setAttribute(name, value);
  parent.append(el);
  return el;
}

/** A page with the template name registered the way name-field.tsx does, saying `text`. */
function pageWithName(text: string) {
  const targets = createFocusTargets();
  const name = element<HTMLTextAreaElement>("textarea");
  name.value = text;
  targets.register("name", name);
  const context: EscapeContext = { targets, nameAtFocus: "Card offer terms" };
  return { targets, name, context };
}

const NO_CONTEXT: EscapeContext = {
  targets: createFocusTargets(),
  nameAtFocus: null,
};

describe("an escape claim registry", () => {
  it("is spoken for when any claim holds, and not when none does", () => {
    const claims = createEscapeClaims();
    expect(claims.spokenFor(null, NO_CONTEXT)).toBe(false);
    claims.add("never", () => false);
    expect(claims.spokenFor(null, NO_CONTEXT)).toBe(false);
    claims.add("always", () => true);
    expect(claims.spokenFor(null, NO_CONTEXT)).toBe(true);
  });

  it("hands each claim the element the key was pressed on and the context", () => {
    const claims = createEscapeClaims();
    const seen: unknown[] = [];
    claims.add("spy", (target, context) => {
      seen.push(target, context);
      return false;
    });
    const button = element("button");
    claims.spokenFor(button, NO_CONTEXT);
    expect(seen).toEqual([button, NO_CONTEXT]);
  });

  it("lists the claims in the order they were added", () => {
    const claims = createEscapeClaims();
    claims.add("first", () => false);
    claims.add("second", () => false);
    expect(claims.names()).toEqual(["first", "second"]);
  });

  it("takes a claim out when its remover is called, and leaves a replacement alone", () => {
    const claims = createEscapeClaims();
    const remove = claims.add("dialog", () => true);
    expect(claims.spokenFor(null, NO_CONTEXT)).toBe(true);
    remove();
    expect(claims.spokenFor(null, NO_CONTEXT)).toBe(false);

    const removeOld = claims.add("dialog", () => false);
    claims.add("dialog", () => true); // replaces it
    removeOld();
    expect(
      claims.spokenFor(null, NO_CONTEXT),
      "the old remover took out the claim that replaced it",
    ).toBe(true);
  });
});

describe("the rail's escape claims", () => {
  it("are the editor's menus, a name mid-edit, and an open popup", () => {
    expect(railEscapeClaims.names()).toEqual([
      "editor-menu",
      "name-mid-edit",
      "open-popup",
    ]);
  });

  describe("editor-menu", () => {
    it("holds while the editor points at an open `/` menu or `{{` picker", () => {
      const editor = element("div", {
        class: "ProseMirror",
        "aria-controls": "slash-menu",
      });
      const inside = element("p", {}, editor);
      expect(railEscapeClaims.spokenFor(inside, NO_CONTEXT)).toBe(true);
      expect(railEscapeClaims.spokenFor(editor, NO_CONTEXT)).toBe(true);
    });

    it("lets go once the menu has closed, and for a key pressed outside the editor", () => {
      const editor = element("div", { class: "ProseMirror" });
      const outside = element("button");
      expect(railEscapeClaims.spokenFor(editor, NO_CONTEXT)).toBe(false);
      expect(railEscapeClaims.spokenFor(outside, NO_CONTEXT)).toBe(false);
      expect(railEscapeClaims.spokenFor(null, NO_CONTEXT)).toBe(false);
    });
  });

  describe("name-mid-edit", () => {
    it("holds while the name differs from what it said when it got focus", () => {
      const { name, context } = pageWithName("Card offer terms, edited");
      expect(railEscapeClaims.spokenFor(name, context)).toBe(true);
    });

    it("compares the trimmed text", () => {
      const { name, context } = pageWithName("  Card offer terms ");
      expect(railEscapeClaims.spokenFor(name, context)).toBe(false);
    });

    it("lets go when there is no edit to put back", () => {
      const { name, context } = pageWithName("Card offer terms");
      expect(railEscapeClaims.spokenFor(name, context)).toBe(false);
    });

    it("is about the name field only", () => {
      const { context } = pageWithName("Card offer terms, edited");
      const elsewhere = element("button");
      expect(railEscapeClaims.spokenFor(elsewhere, context)).toBe(false);
      expect(railEscapeClaims.spokenFor(null, context)).toBe(false);
    });
  });

  describe("open-popup", () => {
    it.each(["menu", "listbox", "dialog"])(
      "holds while a %s is open",
      (role) => {
        element("div", { role });
        expect(railEscapeClaims.spokenFor(null, NO_CONTEXT)).toBe(true);
      },
    );

    it("lets go when none is on the page", () => {
      element("div", { role: "group" });
      expect(railEscapeClaims.spokenFor(null, NO_CONTEXT)).toBe(false);
    });

    it("lets go of one that is mounted but not on screen", () => {
      const hidden = element("div", { role: "dialog" });
      hidden.getClientRects = () => [] as unknown as DOMRectList;
      expect(railEscapeClaims.spokenFor(null, NO_CONTEXT)).toBe(false);
    });
  });
});

describe("inNameField", () => {
  it("is true for the name field and what is inside it, by registration, not by label", () => {
    const { targets, name } = pageWithName("Card offer terms");
    expect(inNameField(targets, name)).toBe(true);
    expect(inNameField(targets, element("button"))).toBe(false);
    expect(inNameField(targets, null)).toBe(false);
  });

  it("is false while no name is registered", () => {
    expect(inNameField(createFocusTargets(), element("textarea"))).toBe(false);
  });
});
