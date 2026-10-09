// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from "./tabs";
import { TAB, TAB_LABEL } from "./tab-styles";

// The app's tabs: Base UI's tablist in the workspace tab bar's look, the underline under the chosen
// tab only, the arrow keys choosing as they move.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type View = "overview" | "consumers";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const tabs = () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
const tab = (name: string) => tabs().find((t) => t.textContent?.startsWith(name))!;
const panels = () => [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
const underlines = () => [...container.querySelectorAll('[role="tab"] > span:last-child:not(:first-child)')];

function Bar({ onChange = () => {}, keepMounted = false }: { onChange?: (v: View) => void; keepMounted?: boolean }) {
  const [value, setValue] = useState<View>("overview");
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    >
      <TabList label="Usage">
        <Tab value="overview">Overview</Tab>
        <Tab value="consumers">
          Consumers<span>3</span>
        </Tab>
      </TabList>
      <TabPanel value="overview" keepMounted={keepMounted}>
        Overview panel
      </TabPanel>
      <TabPanel value="consumers" keepMounted={keepMounted}>
        Consumers panel
      </TabPanel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("is a tablist named by its label, with the chosen tab selected and underlined", async () => {
    await show(<Bar />);
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Usage");
    expect(tabs().map((t) => [t.textContent, t.getAttribute("aria-selected"), t.tabIndex])).toEqual([
      ["Overview", "true", 0],
      ["Consumers3", "false", -1],
    ]);
    expect(underlines()).toHaveLength(1);
    expect(tab("Overview").lastElementChild?.className).toContain("h-0.5");
  });

  it("wears the tab idiom: the 44px box and the label the focus ring goes round, with the count inside it", async () => {
    await show(<Bar />);
    for (const c of TAB.split(" ")) expect(tab("Consumers").className).toContain(c);
    expect(tab("Overview").className).toContain("font-medium");
    expect(tab("Consumers").className).toContain("text-text-muted");
    const label = tab("Consumers").firstElementChild!;
    expect(label.className).toBe(TAB_LABEL);
    expect(label.textContent).toBe("Consumers3");
  });

  it("chooses a tab on a click, and shows its panel", async () => {
    const onChange = vi.fn();
    await show(<Bar onChange={onChange} />);
    expect(panels().map((p) => p.textContent)).toEqual(["Overview panel"]);
    await act(async () => tab("Consumers").click());
    expect(onChange).toHaveBeenCalledWith("consumers");
    expect(tab("Consumers").getAttribute("aria-selected")).toBe("true");
    expect(panels().map((p) => p.textContent)).toEqual(["Consumers panel"]);
    expect(underlines()).toHaveLength(1);
  });

  it("chooses as the arrow keys move, round from the end", async () => {
    const onChange = vi.fn();
    await show(<Bar onChange={onChange} />);
    const arrow = (key: string) =>
      act(async () => {
        const focused = document.activeElement as HTMLElement;
        focused.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      });
    await act(async () => tab("Overview").focus());
    await arrow("ArrowRight");
    expect(document.activeElement).toBe(tab("Consumers"));
    expect(onChange).toHaveBeenLastCalledWith("consumers");
    await arrow("ArrowRight");
    expect(document.activeElement).toBe(tab("Overview"));
    expect(onChange).toHaveBeenLastCalledWith("overview");
  });

  it("links each tab to its panel, and keeps a hidden panel mounted when asked", async () => {
    await show(<Bar keepMounted />);
    const [overview, consumers] = panels();
    expect(overview.hidden).toBe(false);
    expect(consumers.hidden).toBe(true);
    expect(tab("Overview").getAttribute("aria-controls")).toBe(overview.id);
    expect(overview.getAttribute("aria-labelledby")).toBe(tab("Overview").id);
    // Panels take focus from code only, not from Tab.
    expect(overview.tabIndex).toBe(-1);
  });

  it("takes an id and aria-controls for a panel that lives elsewhere on the page", () => {
    const html = renderToStaticMarkup(
      <Tabs value="document" onValueChange={() => {}}>
        <TabList label="View">
          <Tab value="document" id="review-tab-document" aria-controls="review-panel-document">
            Document
          </Tab>
          <Tab value="preview" id="review-tab-preview">
            Preview
          </Tab>
        </TabList>
      </Tabs>,
    );
    expect(html).toMatch(/id="review-tab-document"/);
    expect(html).toMatch(/aria-controls="review-panel-document"/);
    expect(html).toMatch(/id="review-tab-preview"/);
  });
});
