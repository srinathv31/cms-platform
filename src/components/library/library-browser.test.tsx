// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryRow } from "@/server/queries/library";

// The Library's list says which kind each template is, on the line under its name beside the ID, so a team
// with documents and alerts can tell them apart without opening each one.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/actions/create-template", () => ({ createTemplate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), unstable_rethrow: () => {} }));

const { LibraryBrowser } = await import("./library-browser");

const owner = { name: "Maya Chen", initials: "MC", hue: 210 };
const row = (id: string, name: string, family: LibraryRow["family"]): LibraryRow => ({
  id,
  name,
  family,
  teamSlug: "coral-offers",
  teamName: "Coral Offers",
  status: "active",
  sunsetDay: null,
  sunsetPassed: false,
  activeNumber: 1,
  lastEdited: "2 days ago",
  owner,
});

const ROWS = [
  row("UC-4F7K2Q", "Cash Back Terms", "document"),
  row("UC-8H3M9P", "Payment Due Reminder", "message"),
  row("UC-2D6N5R", "Balance Transfer", "document"),
];

let root: Root;
let container: HTMLElement;

async function show(showTeam = false) {
  await act(async () =>
    root.render(
      <LibraryBrowser rows={ROWS} spaceSlug="coral-offers" showTeam={showTeam} canCreate nowIso="2026-10-04T12:00:00.000Z" />,
    ),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** Each row's second line: the ID, then the kind. */
const sublines = () =>
  [...container.querySelectorAll("ul > li a")].map((a) => a.querySelector("span.font-mono")!.parentElement!.textContent);

describe("Library rows name the template's kind", () => {
  it("prints Document or Alert after the ID on every row, from the row's family", async () => {
    await show();
    expect(sublines()).toEqual(["UC-4F7K2Q · Document", "UC-8H3M9P · Alert", "UC-2D6N5R · Document"]);
  });

  it("marks the kind the same way in All teams, before the team that shows on a narrow canvas", async () => {
    await show(true);
    expect(sublines()).toEqual([
      "UC-4F7K2Q · Document · Coral Offers",
      "UC-8H3M9P · Alert · Coral Offers",
      "UC-2D6N5R · Document · Coral Offers",
    ]);
  });

  it("carries the family on the marker, so it can be told apart without reading the word", async () => {
    await show();
    const kinds = [...container.querySelectorAll("ul > li a [data-kind]")].map((el) => el.getAttribute("data-kind"));
    expect(kinds).toEqual(["document", "message", "document"]);
  });
});
