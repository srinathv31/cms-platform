// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonaSummary } from "@/server/queries/personas";

// The profile menu shows who you are. Its persona switcher is a demo tool: the menu has it only when it is
// given personas, which the top bar does in demo mode alone (decision 0051).

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/actions/persona", () => ({ switchPersona: vi.fn() }));

const { ProfileMenu } = await import("./profile-menu");

const maya: PersonaSummary = {
  id: "maya",
  name: "Maya Chen",
  initials: "MC",
  hue: 40,
  summary: "Coral Offers · Author",
};
const jordan: PersonaSummary = {
  id: "jordan",
  name: "Jordan Lee",
  initials: "JL",
  hue: 200,
  summary: "Coral Offers · Approver",
};

let root: Root;
let container: HTMLElement;

function mount(personas: PersonaSummary[] | null) {
  act(() =>
    root.render(
      <ProfileMenu me={maya} personas={personas} canRequestAccess={true} />,
    ),
  );
}

function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>(
    "button[aria-label^='Maya Chen']",
  )!;
  act(() => trigger.click());
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("ProfileMenu", () => {
  it("offers the persona switcher when it has personas", () => {
    mount([maya, jordan]);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Maya Chen, profile and persona",
    );
    openMenu();
    expect(document.body.textContent).toContain("Switch persona");
    expect(document.body.textContent).toContain("Jordan Lee");
  });

  it("has no switcher without them, and says who you are and how to ask for access", () => {
    mount(null);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Maya Chen, profile",
    );
    openMenu();
    expect(document.body.textContent).toContain("Coral Offers · Author");
    expect(document.body.textContent).toContain("Request access");
    expect(document.body.textContent).not.toContain("Switch persona");
    expect(document.body.textContent).not.toContain("Jordan Lee");
  });
});
