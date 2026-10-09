// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimNoticeView } from "@/simulator/types";
import { NoticesPanel } from "./notices-panel";

// Coral's notice inbox: every notice kind Stencil sends gets a title and a tone, and the API's sentence as is.

vi.mock("@/simulator/actions", () => ({ markNoticesRead: vi.fn(async () => ({ ok: true })) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAME = "Balance Transfer Intro — Terms";

const notice = (over: Partial<SimNoticeView>): SimNoticeView => ({
  id: "ntc_1",
  kind: "new_version",
  createdAt: "2027-03-04T00:00:00.000Z",
  templateId: "UC-D6KSGY",
  templateName: NAME,
  versionNumber: 1,
  message: "",
  lines: [],
  read: false,
  offerIds: [],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("NoticesPanel", () => {
  it("shows a sunset_passed notice with its title and Stencil's sentence", () => {
    const message = `${NAME} v1 stopped rendering: its sunset passed on October 30, 2026. Move to v2.`;
    act(() => root.render(<NoticesPanel notices={[notice({ id: "ntc_9", kind: "sunset_passed", message })]} offerNames={{}} />));
    const item = container.querySelector("li")!;
    expect(item.textContent).toContain("v1 sunset passed");
    expect(item.textContent).toContain(message);
    expect(item.querySelector('[aria-label="Unread"]')).not.toBeNull();
  });

  it("titles every kind", () => {
    const kinds = ["new_version", "sunset_scheduled", "sunset_passed", "revoked"] as const;
    act(() =>
      root.render(
        <NoticesPanel notices={kinds.map((kind, i) => notice({ id: `ntc_${i}`, kind, versionNumber: 2 }))} offerNames={{}} />,
      ),
    );
    expect([...container.querySelectorAll("li p.font-semibold")].map((p) => p.textContent)).toEqual([
      "New version: v2",
      "Sunset scheduled for v2",
      "v2 sunset passed",
      "v2 revoked",
    ]);
  });
});
