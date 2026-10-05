import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

// A sunset is a calendar day, stored as that day's midnight UTC. The badge must name that day in every
// time zone: formatted in local time, a US viewer saw the evening before ("Sunset Oct 16" for Oct 17).

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("StatusBadge sunset", () => {
  it("shows the stored UTC day, not the local one", () => {
    const html = renderToStaticMarkup(<StatusBadge state="superseded" sunsetAt={new Date("2026-10-17T00:00:00.000Z")} />);
    expect(text(html)).toBe("Superseded· Sunset Oct 17");
  });

  it("shows no sunset on other states or without a date", () => {
    const at = new Date("2026-10-17T00:00:00.000Z");
    expect(text(renderToStaticMarkup(<StatusBadge state="active" sunsetAt={at} />))).toBe("Active");
    expect(text(renderToStaticMarkup(<StatusBadge state="superseded" />))).toBe("Superseded");
  });
});
