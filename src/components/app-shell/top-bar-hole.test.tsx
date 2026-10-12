import { Children, isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/domain/types";
import type { PersonaSummary } from "@/server/queries/personas";

// The top bar hands the profile menu the personas to switch to only when the server runs in demo mode
// (decision 0051). It reads the flag after the viewer, so it is read at request time.

const env = vi.hoisted(() => ({ demoMode: false }));

vi.mock("@/server/config", () => ({
  get DEMO_MODE() {
    return env.demoMode;
  },
}));

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

vi.mock("@/server/viewer", () => ({
  getViewer: async () =>
    ({ userId: "maya", name: "Maya Chen", initials: "MC" }) as Viewer,
}));
vi.mock("@/server/queries/spaces", () => ({
  getShell: async () => ({ spaces: [] }),
}));
vi.mock("@/server/queries/personas", () => ({
  getPersonaSummaries: async () => [maya, jordan],
}));
vi.mock("@/server/queries/notifications", () => ({
  getNotificationsData: async () => ({}),
}));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./notifications-popover", () => ({
  NotificationsPopover: () => null,
}));
vi.mock("./profile-menu", () => ({ ProfileMenu: () => null }));

const { TopBarHole } = await import("./top-bar-hole");
const { ProfileMenu } = await import("./profile-menu");

/** The props the top bar gave the profile menu. */
async function profileMenuProps() {
  const bar = (await TopBarHole()) as ReactElement<{
    children: ReactElement[];
  }>;
  const menu = Children.toArray(bar.props.children).find(
    (child): child is ReactElement<Record<string, unknown>> =>
      isValidElement(child) && child.type === ProfileMenu,
  );
  return menu!.props;
}

beforeEach(() => {
  env.demoMode = false;
});

describe("TopBarHole", () => {
  it("gives the profile menu no personas with the flag off", async () => {
    const props = await profileMenuProps();
    expect(props.personas).toBeNull();
    expect(props.me).toEqual(maya);
  });

  it("gives it every persona with the flag on", async () => {
    env.demoMode = true;
    expect((await profileMenuProps()).personas).toEqual([maya, jordan]);
  });
});
