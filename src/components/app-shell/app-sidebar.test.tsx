// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, NavDrawerTrigger } from "./app-sidebar";

// Below 800px the sidebar is the shadcn sidebar's sheet, opened from a top-bar button; from 800px up it is the column
// it always was (decision 0045).

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
let narrow = false;

function setWidth(isNarrow: boolean) {
  narrow = isNarrow;
  window.matchMedia = ((query: string) => ({
    matches: narrow,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function mount() {
  act(() =>
    root.render(
      <SidebarProvider>
        <NavDrawerTrigger />
        <AppSidebar>
          <a href="#library">Library</a>
        </AppSidebar>
      </SidebarProvider>,
    ),
  );
}

const trigger = () =>
  container.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')!;
const drawer = () =>
  document.querySelector('[data-slot="sidebar"][data-mobile="true"]');

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AppSidebar below 800px", () => {
  beforeEach(() => {
    setWidth(true);
    mount();
  });

  it("is closed, with a named button that opens it", () => {
    expect(drawer()).toBeNull();
    expect(trigger().getAttribute("aria-label")).toBe("Open navigation");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    act(() => trigger().click());

    expect(drawer()).not.toBeNull();
    expect(drawer()?.textContent).toContain("Library");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("closes when a link in it is followed", () => {
    act(() => trigger().click());
    const link = drawer()!.querySelector<HTMLAnchorElement>("a")!;

    act(() => link.click());

    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("is not in the page as a column", () => {
    expect(container.querySelector('[data-slot="sidebar"]')).toBeNull();
  });
});

describe("AppSidebar from 800px up", () => {
  beforeEach(() => {
    setWidth(false);
    mount();
  });

  it("is the fixed column, in the page and not a sheet", () => {
    const column = container.querySelector('[data-slot="sidebar"]');
    expect(column?.textContent).toContain("Library");
    expect(column?.getAttribute("role")).toBe("navigation");
    expect(column?.getAttribute("aria-label")).toBe("Sidebar");
    expect(drawer()).toBeNull();
  });

  it("keeps the CSS that hides the column in a narrow window before the page has scripts", () => {
    expect(
      container.querySelector('[data-slot="sidebar"]')?.className,
    ).toContain("narrow:hidden");
  });

  it("has a trigger that the CSS hides at this width", () => {
    expect(trigger().className).toContain("wide:hidden");
  });
});
