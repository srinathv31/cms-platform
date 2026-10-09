// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { HeatCell, UsageHeatmap } from "@/domain/golive-types";
import { ChannelMix, Heatmap, RateLine, SERIES, StackedBars, type RatePoint, type StackDatum, type StackSeries } from "./charts";

// No chart value is hover-only: every chart is followed by an sr-only table of its values, its marks are
// one Tab stop with arrow keys between them, and series are told apart by hue.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHANNELS: StackSeries[] = [
  { label: "PDF", ...SERIES[0] },
  { label: "Web", ...SERIES[1] },
  { label: "Email", ...SERIES[2] },
];
const WEEKS: StackDatum[] = [
  { label: "Sep 21", title: "Week of Sep 21", parts: [812, 1520, 12] },
  { label: "Sep 28", title: "Week of Sep 28", parts: [790, 1498, 0] },
  { label: "Oct 5", title: "Week of Oct 5", parts: [301, 640, 4], partial: true },
];
const DAYS: RatePoint[] = [
  { title: "Oct 7", pct: 0, detail: "0 of 251 renders" },
  { title: "Oct 8", pct: 2.4, detail: "6 of 250 renders" },
  { title: "Oct 9 (so far)", pct: 0, detail: "No renders" },
];

function html(node: React.ReactNode) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(node);
  return host;
}

/** The sr-only table's caption, header row and body rows, as text. */
function table(host: HTMLElement) {
  const t = host.querySelector("table.sr-only");
  if (!t) throw new Error("no sr-only table");
  const cells = (row: Element) => [...row.children].map((c) => c.textContent);
  return {
    caption: t.querySelector("caption")?.textContent,
    head: cells(t.querySelector("thead tr")!),
    rows: [...t.querySelectorAll("tbody tr")].map(cells),
  };
}

const marks = (host: ParentNode) => [...host.querySelectorAll<SVGElement>("[data-mark]")];

describe("an sr-only table follows every chart, with its values", () => {
  it("stacked bars: a row per period, a column per series, and the total", () => {
    const host = html(<StackedBars label="Renders over time, by channel" periodHeader="Week of" series={CHANNELS} data={WEEKS} />);
    expect(table(host)).toEqual({
      caption: "Renders over time, by channel",
      head: ["Week of", "PDF", "Web", "Email", "Total"],
      rows: [
        ["Sep 21", "812", "1,520", "12", "2,344"],
        ["Sep 28", "790", "1,498", "0", "2,288"],
        ["Oct 5 (so far)", "301", "640", "4", "945"],
      ],
    });
  });

  it("rate line: a row per day, with its rate and what it was of", () => {
    const host = html(<RateLine label="Failed renders per day, last 30 days" points={DAYS} startLabel="Oct 7" midLabel="Oct 8" endLabel="Oct 9" />);
    expect(table(host)).toEqual({
      caption: "Failed renders per day, last 30 days",
      head: ["Day", "Failure rate", "Failed"],
      rows: [
        ["Oct 7", "0.0%", "0 of 251 renders"],
        ["Oct 8", "2.4%", "6 of 250 renders"],
        ["Oct 9 (so far)", "0.0%", "No renders"],
      ],
    });
  });

  it("channel mix: each channel's count and share", () => {
    const host = html(
      <ChannelMix
        parts={[
          { label: "PDF", value: 3529 },
          { label: "Web", value: 2540 },
          { label: "Email", value: 63 },
        ]}
      />,
    );
    expect(table(host)).toEqual({
      caption: "Renders by channel",
      head: ["Channel", "Renders", "Share"],
      rows: [
        ["PDF", "3,529", "58%"],
        ["Web", "2,540", "41%"],
        ["Email", "63", "1%"],
      ],
    });
  });

  it("heatmap: a row per week, as before", () => {
    const host = html(<Heatmap heat={HEAT} />);
    expect(table(host)).toEqual({
      caption: "Renders by week",
      head: ["Week of", "Renders", "Busiest day"],
      rows: [
        ["Sep 27", "20", "Oct 3, 6"],
        ["Oct 4", "21", "Oct 9, 6"],
      ],
    });
  });
});

describe("each readable mark names its values, and the chart is one Tab stop", () => {
  it("stacked bars: one mark per period", () => {
    const all = marks(html(<StackedBars label="x" periodHeader="Week of" series={CHANNELS} data={WEEKS} />));
    expect(all.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Week of Sep 21: PDF 812, Web 1,520, Email 12",
      "Week of Sep 28: PDF 790, Web 1,498, Email 0",
      "Week of Oct 5 (so far): PDF 301, Web 640, Email 4",
    ]);
    expect(all.map((m) => m.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("rate line: one mark per day", () => {
    const all = marks(html(<RateLine label="x" points={DAYS} startLabel="a" midLabel="b" endLabel="c" />));
    expect(all.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Oct 7: 0.0% failed, 0 of 251 renders",
      "Oct 8: 2.4% failed, 6 of 250 renders",
      "Oct 9 (so far): 0.0% failed, No renders",
    ]);
    expect(all.filter((m) => m.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("heatmap: one mark per day in range, none for the days after today", () => {
    const all = marks(html(<Heatmap heat={HEAT} />));
    expect(all).toHaveLength(13);
    expect(all[0]!.getAttribute("aria-label")).toBe("Sun, Sep 27, 2026: 1 render");
    expect(all[12]!.getAttribute("aria-label")).toBe("Fri, Oct 9, 2026: 6 renders");
    expect(all.filter((m) => m.getAttribute("tabindex") === "0")).toEqual([all[0]]);
  });
});

describe("series are told apart by hue", () => {
  it("each series of the stacked bars is drawn in its own series hue, not a lightness step of one", () => {
    const host = html(<StackedBars label="x" periodHeader="Week of" series={CHANNELS} data={WEEKS.slice(0, 1)} />);
    const fills = [...host.querySelectorAll("rect:not([data-mark])")].map((r) => r.getAttribute("class"));
    expect(fills).toEqual(["fill-series-1", "fill-series-2", "fill-series-3"]);
  });
});

// ── The keyboard ─────────────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return marks(container);
}

async function press(key: string) {
  const target = document.activeElement as Element;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const focused = (all: SVGElement[]) => all.indexOf(document.activeElement as SVGElement);

describe("ChartKeys: the arrow keys move between a chart's marks", () => {
  it("in a row: Left and Right step, Home and End go to the ends, and the Tab stop follows", async () => {
    const all = await mount(<RateLine label="x" points={DAYS} startLabel="a" midLabel="b" endLabel="c" />);
    await act(async () => all[0]!.focus());
    expect(focused(all)).toBe(0);
    await press("ArrowRight");
    expect(focused(all)).toBe(1);
    expect(all.map((m) => m.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    await press("End");
    expect(focused(all)).toBe(2);
    await press("ArrowRight");
    expect(focused(all), "stays at the end").toBe(2);
    await press("Home");
    expect(focused(all)).toBe(0);
    await press("ArrowLeft");
    expect(focused(all), "stays at the start").toBe(0);
  });

  it("in the heatmap: Up and Down are a day, Left and Right a week", async () => {
    const all = await mount(<Heatmap heat={HEAT} />);
    await act(async () => all[0]!.focus());
    await press("ArrowRight");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(/^Sun, Oct 4/);
    await press("ArrowDown");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(/^Mon, Oct 5/);
    await press("ArrowLeft");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(/^Mon, Sep 28/);
    await press("ArrowUp");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(/^Sun, Sep 27/);
  });
});

// Two weeks, Sunday on top: Sep 27 to Oct 9 in range, Oct 10 (Saturday) after today.
const COUNTS = [1, 1, 2, 3, 4, 3, 6, 2, 3, 1, 4, 5, 6, 0];
const heatDays: HeatCell[] = COUNTS.map((count, i) => ({
  date: new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10),
  count,
  level: 1,
  inRange: i < 13,
}));
const HEAT: UsageHeatmap = {
  weeks: [heatDays.slice(0, 7), heatDays.slice(7)],
  months: [{ label: "Oct", week: 1 }],
  thresholds: [1, 2, 4, 6],
  total: heatDays.reduce((s, c) => s + c.count, 0),
  busiest: { date: "2026-10-03", count: 6 },
};
