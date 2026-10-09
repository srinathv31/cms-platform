import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

// A sunset is a calendar day in the business time zone; the read model hands the badge that day
// (YYYY-MM-DD). The badge must name it in every viewer's time zone: read as a local date, a US viewer saw
// the evening before ("Sunset Oct 16" for Oct 17).

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("StatusBadge sunset", () => {
  it("shows the sunset's day as given, not the viewer's local reading of it", () => {
    const html = renderToStaticMarkup(<StatusBadge state="superseded" sunsetDay="2026-10-17" />);
    expect(text(html)).toBe("Superseded· Sunset Oct 17");
  });

  it("says the year when the sunset isn't in the demo clock's year", () => {
    const html = renderToStaticMarkup(<StatusBadge state="superseded" sunsetDay="2027-01-03" now="2026-10-09T12:00:00.000Z" />);
    expect(text(html)).toBe("Superseded· Sunset Jan 3, 2027");
  });

  it("shows no sunset on other states or without a date", () => {
    expect(text(renderToStaticMarkup(<StatusBadge state="active" sunsetDay="2026-10-17" />))).toBe("Active");
    expect(text(renderToStaticMarkup(<StatusBadge state="superseded" />))).toBe("Superseded");
  });
});
