// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaletteResults, PaletteTemplateRow } from "@/domain/import-types";
import type { SpaceNav } from "@/server/queries/spaces";

// The ⌘K palette asks GET /api/palette/{space} only once it opens, and searches there as the viewer
// types. What it keeps is one viewer's: after a persona switch nothing read for the last viewer shows.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// cmdk keeps the selected row in view; happy-dom has no layout.
Element.prototype.scrollIntoView = () => {};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/coral-offers/library",
  useParams: () => ({ team: "coral-offers" }),
}));

type Answer = { ok: true } & PaletteResults;
/** The palette route as the browser reaches it: handed the URL fetched, it gives the answer. */
const paletteRoute = vi.hoisted(() => vi.fn<(url: string) => Promise<Answer>>());
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const body = await paletteRoute(url);
    return { ok: true, status: 200, json: async () => body };
  }),
);

const { CommandPalette } = await import("./command-palette");
const { SEARCH_PAUSE_MS } = await import("@/components/palette/use-palette-results");

const coral: SpaceNav = {
  slug: "coral-offers",
  name: "Coral Offers",
  kind: "team",
  icon: "users",
  showAudit: false,
  settings: { team: false, platform: false },
  recert: null,
  card: null,
};

const row = (id: string, name: string): PaletteTemplateRow => ({ id, name, teamSlug: "coral-offers", teamName: "Coral Offers", status: "active" });
const CASH_BACK = row("UC-AAAAAA", "Cash Back Welcome Bonus");
const BALANCE = row("UC-BBBBBB", "Balance Transfer Intro");

const answer = (viewerId: string, over: Partial<PaletteResults> = {}): Answer => ({
  ok: true,
  viewerId,
  space: "coral-offers",
  query: "",
  canCreate: false,
  current: false,
  recent: [],
  templates: [],
  ...over,
});

let root: Root;
let container: HTMLElement;

const render = (viewerId: string) => act(async () => root.render(<CommandPalette viewerId={viewerId} spaces={[coral]} />));
const wait = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const searchButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Search"))!;
const options = () => [...document.body.querySelectorAll("[cmdk-item]")].map((el) => el.textContent ?? "");
const listed = (name: string) => options().some((text) => text.includes(name));
const input = () => document.body.querySelector<HTMLInputElement>("[cmdk-input]")!;

async function open() {
  await act(async () => searchButton().click());
  await wait();
}

async function close() {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await wait();
}

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A route answer the test hands over when it chooses. */
function deferred() {
  let resolve!: (value: Answer) => void;
  const promise = new Promise<Answer>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  paletteRoute.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("CommandPalette", () => {
  it("asks nothing until it opens, then lists the answer: the templates come from the route", async () => {
    paletteRoute.mockResolvedValue(answer("maya", { canCreate: true, recent: [CASH_BACK], templates: [BALANCE] }));
    await render("maya");
    await wait(SEARCH_PAUSE_MS);
    expect(paletteRoute).not.toHaveBeenCalled();

    await open();
    expect(paletteRoute).toHaveBeenCalledExactlyOnceWith("/api/palette/coral-offers");
    expect(listed("Cash Back Welcome Bonus")).toBe(true);
    expect(listed("Balance Transfer Intro")).toBe(true);
    expect(listed("New template")).toBe(true);
  });

  it("searches on the server after a pause in typing, once for what was typed", async () => {
    paletteRoute.mockImplementation(async (url) =>
      url.includes("q=") ? answer("maya", { query: "bal", templates: [BALANCE] }) : answer("maya", { recent: [CASH_BACK], templates: [BALANCE] }),
    );
    await render("maya");
    await open();
    await type("b");
    await type("ba");
    await type("Bal");
    await wait(SEARCH_PAUSE_MS + 20);
    expect(paletteRoute.mock.calls.map(([url]) => url)).toEqual(["/api/palette/coral-offers", "/api/palette/coral-offers?q=bal"]);
    expect(listed("Balance Transfer Intro")).toBe(true);
    expect(listed("Cash Back Welcome Bonus")).toBe(false);
  });

  it("Enter opens the best match: the first row again once the server's answer replaces a narrowed one", async () => {
    const REVIEW_NOTICE = row("UC-CCCCCC", "Review Notice");
    paletteRoute.mockImplementation(async (url) =>
      url.includes("q=") ? answer("maya", { query: "review", templates: [REVIEW_NOTICE] }) : answer("maya", { templates: [BALANCE] }),
    );
    await render("maya");
    await open();
    await type("review");
    // Narrowed at once: no template of the resting answer matches, the Review page does.
    const selectedRow = () => document.body.querySelector("[cmdk-item][data-selected=true]")?.textContent ?? "";
    expect(selectedRow()).toBe("Review");
    await wait(SEARCH_PAUSE_MS + 20);
    expect(options()[0]).toContain("Review Notice");
    expect(selectedRow()).toContain("Review Notice");
  });

  it("after a persona switch, shows nothing it read for the last viewer, and asks again as the new one", async () => {
    paletteRoute.mockResolvedValue(answer("maya", { canCreate: true, recent: [CASH_BACK], templates: [BALANCE] }));
    await render("maya");
    await open();
    expect(listed("Cash Back Welcome Bonus")).toBe(true);
    await close();

    const sams = deferred();
    paletteRoute.mockReturnValue(sams.promise);
    await render("sam");
    await open();
    // Sam's answer isn't in yet: Maya's cached one must not stand in for it.
    expect(options()).toEqual([]);
    expect(paletteRoute).toHaveBeenLastCalledWith("/api/palette/coral-offers");

    await act(async () => sams.resolve(answer("sam", { templates: [BALANCE] })));
    await wait();
    expect(listed("Balance Transfer Intro")).toBe(true);
    expect(listed("Cash Back Welcome Bonus")).toBe(false);
    expect(listed("New template")).toBe(false);
  });

  it("drops an answer that lands after the persona changed, or one read for somebody else", async () => {
    const mayas = deferred();
    paletteRoute.mockReturnValue(mayas.promise);
    await render("maya");
    await open();
    await close();
    // Maya's question is still out when Sam takes over.
    const sams = deferred();
    paletteRoute.mockReturnValue(sams.promise);
    await render("sam");
    await open();
    await act(async () => mayas.resolve(answer("maya", { canCreate: true, recent: [CASH_BACK] })));
    await wait();
    expect(listed("Cash Back Welcome Bonus")).toBe(false);

    // Asked as Sam, but read for Maya (the cookie changed while it was asked): not shown either.
    await act(async () => sams.resolve(answer("maya", { recent: [CASH_BACK] })));
    await wait();
    expect(listed("Cash Back Welcome Bonus")).toBe(false);
  });
});
