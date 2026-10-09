import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatCard, StatLabel, StatLines, StatTrend, StatValue } from "./stat-card";

// The stat card's parts: the card, the numeral with its trend, the tracked-caps label with its "i", the
// lines under a hairline, and the trend pill.

const html = (node: React.ReactNode) => renderToStaticMarkup(node);

describe("StatCard", () => {
  it("is the tinted card: hairline, 14px corners, 24px padding, no ring", () => {
    const out = html(<StatCard className="min-h-10">x</StatCard>);
    for (const c of ["rounded-xl", "border-hairline", "bg-surface-tinted", "p-6", "ring-0", "min-h-10"]) expect(out).toContain(c);
  });

  it("passes a region's name and slot through", () => {
    const out = html(
      <StatCard role="region" aria-label="Q4 2026 review" data-slot="recert-summary">
        x
      </StatCard>,
    );
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-label="Q4 2026 review"');
    expect(out).toContain('data-slot="recert-summary"');
    expect(out).not.toContain('data-slot="card"');
  });
});

describe("StatValue", () => {
  it("prints the value as given, in the big numeral", () => {
    const out = html(<StatValue value="12,480" />);
    expect(out).toMatch(/class="numeral text-text">12,480</);
  });

  it("puts the trend at the right of the numeral's row", () => {
    const out = html(<StatValue value="94.6%" trend={<span data-trend="" />} />);
    expect(out).toMatch(/justify-between[^>]*><div class="numeral text-text">94.6%<\/div><span data-trend="">/);
  });
});

describe("StatLabel", () => {
  it("is a tracked-caps label", () => {
    expect(html(<StatLabel className="mt-3">Active templates</StatLabel>)).toMatch(/class="caps-label mt-3">Active templates/);
  });

  it("adds an \"i\" named by its tip", () => {
    const out = html(<StatLabel tip="Live renders only.">Renders · 30 days</StatLabel>);
    expect(out).toMatch(/<button[^>]*aria-label="Live renders only\."/);
    expect(html(<StatLabel>Succeeded</StatLabel>)).not.toContain("<button");
  });
});

describe("StatLines", () => {
  it("lists each label with its value under a hairline", () => {
    const out = html(
      <StatLines
        rows={[
          ["Consumers", "1"],
          ["Nearing sunset", "1 version"],
        ]}
      />,
    );
    expect(out).toContain("border-t border-hairline-strong");
    expect(out).toMatch(/<span>Consumers<\/span><span class="text-text-muted">1<\/span>/);
    expect(out).toMatch(/<span>Nearing sunset<\/span><span class="text-text-muted">1 version<\/span>/);
  });
});

describe("StatTrend", () => {
  it("reads up in green and down in red, against the 30 days before", () => {
    const up = html(<StatTrend pct={7.2} />);
    expect(up).toContain("+7.2%");
    expect(up).toContain('aria-label="+7.2% compared with the 30 days before"');
    expect(up).toContain("bg-positive-soft");
    const down = html(<StatTrend pct={-3} />);
    expect(down).toContain("−3%");
    expect(down).toContain("bg-danger-soft");
  });

  it("reads a flat 0 as up", () => {
    expect(html(<StatTrend pct={0} />)).toContain("+0%");
  });
});
