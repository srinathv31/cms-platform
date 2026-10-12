// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { HeatCell, UsageHeatmap } from "@/domain/golive-types";
import type { TemplateUsageData } from "@/domain/golive-types";
import { templateMixParts } from "./channel-series";
import {
  ChannelMix,
  HBars,
  HeatLegend,
  Heatmap,
  RateLine,
  SERIES,
  heatLegendLevels,
  StackedBars,
  type RatePoint,
  type StackDatum,
  type StackSeries,
} from "./charts";

// No chart value is hover-only: every chart is followed by an sr-only table of its values, its marks are
// one Tab stop with arrow keys between them, and series are told apart by hue.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CHANNELS: StackSeries[] = [
  { label: "PDF", ...SERIES[0] },
  { label: "Web", ...SERIES[1] },
  { label: "Email", ...SERIES[2] },
];
const WEEKS: StackDatum[] = [
  { label: "Sep 21", title: "Week of Sep 21", parts: [812, 1520, 12] },
  { label: "Sep 28", title: "Week of Sep 28", parts: [790, 1498, 0] },
  {
    label: "Oct 5",
    title: "Week of Oct 5",
    parts: [301, 640, 4],
    partial: true,
  },
];
const ALERT_MIX: Pick<
  TemplateUsageData,
  "channels" | "byChannel" | "pushByPlatform"
> = {
  channels: ["push", "sms"],
  byChannel: { pdf: 0, web: 0, email: 0, push: 1000, sms: 1000 },
  pushByPlatform: { ios: 580, android: 420, unrecorded: 0 },
};
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

const marks = (host: ParentNode) => [
  ...host.querySelectorAll<SVGElement>("[data-mark]"),
];

describe("an sr-only table follows every chart, with its values", () => {
  it("stacked bars: a row per period, a column per series, and the total", () => {
    const host = html(
      <StackedBars
        label="Renders over time, by channel"
        periodHeader="Week of"
        series={CHANNELS}
        data={WEEKS}
      />,
    );
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
    const host = html(
      <RateLine
        label="Failed renders per day, last 30 days"
        points={DAYS}
        startLabel="Oct 7"
        midLabel="Oct 8"
        endLabel="Oct 9"
      />,
    );
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

  it("channel mix of an alert: Push by phone beside SMS, each with its count and share", () => {
    const host = html(<ChannelMix parts={templateMixParts(ALERT_MIX)} />);
    expect(table(host)).toEqual({
      caption: "Renders by channel",
      head: ["Channel", "Renders", "Share"],
      rows: [
        ["Push · iPhone", "580", "29%"],
        ["Push · Android", "420", "21%"],
        ["SMS", "1,000", "50%"],
      ],
    });
    // The legend prints every share beside its name, so none is left to a tooltip.
    expect(
      [...host.querySelectorAll("ul li")].map((li) => li.textContent),
    ).toEqual(["Push · iPhone 29%", "Push · Android 21%", "SMS 50%"]);
  });

  it("channel mix of a document: PDF, Web and Email, with nothing for a phone", () => {
    const host = html(
      <ChannelMix
        parts={templateMixParts({
          channels: ["pdf", "web", "email"],
          byChannel: { pdf: 50, web: 30, email: 20, push: 0, sms: 0 },
          pushByPlatform: { ios: 0, android: 0, unrecorded: 0 },
        })}
      />,
    );
    expect(table(host).rows).toEqual([
      ["PDF", "50", "50%"],
      ["Web", "30", "30%"],
      ["Email", "20", "20%"],
    ]);
  });

  it("channel mix: pushes logged before the phone was kept get a part of their own, only while there are any", () => {
    const withLegacy = templateMixParts({
      ...ALERT_MIX,
      pushByPlatform: { ios: 500, android: 400, unrecorded: 100 },
    });
    expect(withLegacy.map((p) => [p.label, p.value])).toEqual([
      ["Push · iPhone", 500],
      ["Push · Android", 400],
      ["Push · not recorded", 100],
      ["SMS", 1000],
    ]);
    expect(templateMixParts(ALERT_MIX).map((p) => p.label)).not.toContain(
      "Push · not recorded",
    );
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
    const all = marks(
      html(
        <StackedBars
          label="x"
          periodHeader="Week of"
          series={CHANNELS}
          data={WEEKS}
        />,
      ),
    );
    expect(all.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Week of Sep 21: PDF 812, Web 1,520, Email 12",
      "Week of Sep 28: PDF 790, Web 1,498, Email 0",
      "Week of Oct 5 (so far): PDF 301, Web 640, Email 4",
    ]);
    expect(all.map((m) => m.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
    ]);
  });

  it("rate line: one mark per day", () => {
    const all = marks(
      html(
        <RateLine
          label="x"
          points={DAYS}
          startLabel="a"
          midLabel="b"
          endLabel="c"
        />,
      ),
    );
    expect(all.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Oct 7: 0.0% failed, 0 of 251 renders",
      "Oct 8: 2.4% failed, 6 of 250 renders",
      "Oct 9 (so far): 0.0% failed, No renders",
    ]);
    expect(all.filter((m) => m.getAttribute("tabindex") === "0")).toHaveLength(
      1,
    );
  });

  it("heatmap: one mark per day in range, none for the days after today", () => {
    const all = marks(html(<Heatmap heat={HEAT} />));
    expect(all).toHaveLength(13);
    expect(all[0]!.getAttribute("aria-label")).toBe(
      "Sun, Sep 27, 2026: 1 render",
    );
    expect(all[12]!.getAttribute("aria-label")).toBe(
      "Fri, Oct 9, 2026: 6 renders",
    );
    expect(all.filter((m) => m.getAttribute("tabindex") === "0")).toEqual([
      all[0],
    ]);
  });
});

describe("series are told apart by hue", () => {
  it("each series of the stacked bars is drawn in its own series hue, not a lightness step of one", () => {
    const host = html(
      <StackedBars
        label="x"
        periodHeader="Week of"
        series={CHANNELS}
        data={WEEKS.slice(0, 1)}
      />,
    );
    const fills = [...host.querySelectorAll("rect:not([data-mark])")].map((r) =>
      r.getAttribute("class"),
    );
    expect(fills).toEqual(["fill-series-1", "fill-series-2", "fill-series-3"]);
  });

  it("the channel mix of a template wears each channel's own hue, not the hue of its place in a shorter list", () => {
    const host = html(<ChannelMix parts={templateMixParts(ALERT_MIX)} />);
    const swatches = [
      ...host.querySelectorAll("ul li > span[aria-hidden]"),
    ].map((s) => s.className);
    // Push is the fourth channel's rose and SMS the fifth's blue, as in "Renders over time"; Android is the rose one step fainter.
    expect(swatches.map((c) => /\bbg-series-\d\b/.exec(c)?.[0])).toEqual([
      "bg-series-4",
      "bg-series-4",
      "bg-series-5",
    ]);
    expect(swatches.map((c) => c.includes("opacity-55"))).toEqual([
      false,
      true,
      false,
    ]);
    // And the bar's segments are drawn the same way.
    const segments = [...host.querySelectorAll("div.flex > span")].map(
      (s) => s.className,
    );
    expect(segments.map((c) => /\bbg-series-\d\b/.exec(c)?.[0])).toEqual([
      "bg-series-4",
      "bg-series-4",
      "bg-series-5",
    ]);
    expect(segments.map((c) => c.includes("opacity-55"))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("a part the channel series can place still takes its hue from its place", () => {
    const host = html(
      <ChannelMix
        parts={[
          { label: "PDF", value: 1 },
          { label: "Web", value: 1 },
        ]}
      />,
    );
    expect(
      [...host.querySelectorAll("ul li > span[aria-hidden]")].map(
        (s) => /\bbg-series-\d\b/.exec(s.className)?.[0],
      ),
    ).toEqual(["bg-series-1", "bg-series-2"]);
  });

  it("the bars of a ranking are one colour: the length is the value, and a shade would read as a category", () => {
    const rows = [
      { key: "a", label: "Spring Travel", value: 40, share: 0.5 },
      { key: "b", label: "Card Abroad", value: 24, share: 0.3 },
      { key: "c", label: "Welcome", value: 16, share: 0.2 },
    ];
    for (const labelSide of ["top", "right"] as const) {
      const host = html(<HBars rows={rows} labelSide={labelSide} />);
      const fills = [...host.querySelectorAll("li div[style]")].map((bar) =>
        [...bar.classList].filter((c) => /^(bg|text)-/.test(c)).join(" "),
      );
      expect(fills).toHaveLength(3);
      expect(
        new Set(fills).size,
        `one fill and one ink on the ${labelSide}-labelled bars`,
      ).toBe(1);
    }
  });
});

describe("the heatmap's legend prints the renders a day each shade means", () => {
  const legend = (thresholds: UsageHeatmap["thresholds"]) => {
    const host = html(<HeatLegend thresholds={thresholds} />);
    const items = [...host.querySelectorAll("li")];
    return {
      host,
      items,
      printed: items.map(
        (li) => li.querySelector("[aria-hidden]")?.textContent,
      ),
      spoken: items.map((li) => li.querySelector(".sr-only")?.textContent),
    };
  };

  it("one range per shade, least to most, printed in the swatch and spoken as words", () => {
    const { host, items, printed, spoken } = legend([1, 3, 9, 24]);
    expect(printed).toEqual(["0", "1", "2–3", "4–9", "10–24"]);
    expect(spoken).toEqual(["0", "1", "2 to 3", "4 to 9", "10 to 24"]);
    expect(host.querySelector("ul")?.getAttribute("aria-label")).toBe(
      "Renders in a day",
    );
    // Each swatch is the shade its range is for, in the heat steps' order, with text that reads on it.
    expect(items.map((li) => /\b(bg-[\w-]+)/.exec(li.className)?.[1])).toEqual([
      "bg-heat-empty",
      "bg-brand-1",
      "bg-brand-2",
      "bg-brand-3",
      "bg-brand-4",
    ]);
    expect(
      items.map((li) => /\btext-(?:text|white)\b/.exec(li.className)?.[0]),
    ).toEqual([
      "text-text",
      "text-text",
      "text-text",
      "text-text",
      "text-white",
    ]);
  });

  it("counts with the thousands separator the rest of the page uses", () => {
    expect(legend([40, 1200, 2500, 12000]).printed).toEqual([
      "0",
      "1–40",
      "41–1,200",
      "1,201–2,500",
      "2,501–12,000",
    ]);
  });

  it("leaves out a shade no day can wear, where thresholds tie", () => {
    expect(legend([3, 3, 5, 5]).spoken).toEqual(["0", "1 to 3", "4 to 5"]);
    expect(legend([2, 2, 2, 2]).spoken).toEqual(["0", "1 to 2"]);
    expect(legend([1, 1, 1, 1]).spoken).toEqual(["0", "1"]);
    expect(legend([0, 0, 0, 0]).spoken, "no renders at all").toEqual(["0"]);
  });

  it("agrees with the levels the heatmap gives each day", () => {
    // Every count from 1 to the top falls in the range printed for its level.
    const thresholds: UsageHeatmap["thresholds"] = [2, 2, 7, 12];
    const printed = heatLegendLevels(thresholds);
    const levelOf = (count: number) =>
      count <= thresholds[0]
        ? 1
        : count <= thresholds[1]
          ? 2
          : count <= thresholds[2]
            ? 3
            : 4;
    for (let count = 1; count <= thresholds[3]; count++) {
      const { from, to } = printed.find((p) => p.level === levelOf(count))!;
      expect(count >= from && count <= to, `${count} in ${from} to ${to}`).toBe(
        true,
      );
    }
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
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

const focused = (all: SVGElement[]) =>
  all.indexOf(document.activeElement as SVGElement);

describe("ChartKeys: the arrow keys move between a chart's marks", () => {
  it("in a row: Left and Right step, Home and End go to the ends, and the Tab stop follows", async () => {
    const all = await mount(
      <RateLine
        label="x"
        points={DAYS}
        startLabel="a"
        midLabel="b"
        endLabel="c"
      />,
    );
    await act(async () => all[0]!.focus());
    expect(focused(all)).toBe(0);
    await press("ArrowRight");
    expect(focused(all)).toBe(1);
    expect(all.map((m) => m.getAttribute("tabindex"))).toEqual([
      "-1",
      "0",
      "-1",
    ]);
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
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(
      /^Sun, Oct 4/,
    );
    await press("ArrowDown");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(
      /^Mon, Oct 5/,
    );
    await press("ArrowLeft");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(
      /^Mon, Sep 28/,
    );
    await press("ArrowUp");
    expect(all[focused(all)]!.getAttribute("aria-label")).toMatch(
      /^Sun, Sep 27/,
    );
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
