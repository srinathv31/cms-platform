// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Stamp } from "./stamp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Stamp", () => {
  it("takes the keyboard's focus, so its tooltip is reachable, and carries the absolute time for assistive technology", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<Stamp iso="2026-10-05T02:29:00.000Z" relative="3 hours ago" absolute="Mon, Oct 5, 2026, 2:29 AM UTC" />),
    );

    const time = container.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-10-05T02:29:00.000Z");
    expect(time.tabIndex).toBe(0);
    expect(time.textContent).toBe("3 hours ago, Mon, Oct 5, 2026, 2:29 AM UTC");
    expect(time.querySelector(".sr-only")).not.toBeNull();

    await act(async () => time.focus());
    expect(document.activeElement).toBe(time);
    await act(async () => root.unmount());
  });
});
