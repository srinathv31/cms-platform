import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

// A sunset is a calendar day in the business time zone; the read model hands the badge that day
// (YYYY-MM-DD). The badge must name it in every viewer's time zone: read as a local date, a US viewer saw
// the evening before ("Sunset Oct 16" for Oct 17).

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("StatusBadge sunset", () => {
  it("shows the sunset's day as given, not the viewer's local reading of it", () => {
    const html = renderToStaticMarkup(
      <StatusBadge state="superseded" sunsetDay="2026-10-17" />,
    );
    expect(text(html)).toBe("Superseded· Sunset Oct 17");
  });

  it("says the year when the sunset isn't in the demo clock's year", () => {
    const html = renderToStaticMarkup(
      <StatusBadge
        state="superseded"
        sunsetDay="2027-01-03"
        now="2026-10-09T12:00:00.000Z"
      />,
    );
    expect(text(html)).toBe("Superseded· Sunset Jan 3, 2027");
  });

  it("shows no sunset on other states or without a date", () => {
    expect(
      text(
        renderToStaticMarkup(
          <StatusBadge state="active" sunsetDay="2026-10-17" />,
        ),
      ),
    ).toBe("Active");
    expect(text(renderToStaticMarkup(<StatusBadge state="superseded" />))).toBe(
      "Superseded",
    );
    expect(
      text(
        renderToStaticMarkup(<StatusBadge state="superseded" sunsetPassed />),
      ),
    ).toBe("Superseded");
    expect(
      text(
        renderToStaticMarkup(
          <StatusBadge state="active" sunsetDay="2026-10-17" sunsetPassed />,
        ),
      ),
    ).toBe("Active");
  });

  // Once the sunset has passed the version no longer renders, so the badge can't read like a date to come.
  // The read model decides it (`sunsetPassed`); the badge only words it.
  it("says 'Sunset passed' once the read model says the sunset has passed, and 'Sunset' before", () => {
    const passed = renderToStaticMarkup(
      <StatusBadge state="superseded" sunsetDay="2026-10-01" sunsetPassed />,
    );
    expect(text(passed)).toBe("Superseded· Sunset passed Oct 1");
    const ahead = renderToStaticMarkup(
      <StatusBadge
        state="superseded"
        sunsetDay="2026-10-17"
        sunsetPassed={false}
      />,
    );
    expect(text(ahead)).toBe("Superseded· Sunset Oct 17");
    expect(
      text(
        renderToStaticMarkup(
          <StatusBadge state="superseded" sunsetDay="2026-10-17" />,
        ),
      ),
    ).toBe("Superseded· Sunset Oct 17");
  });

  it("names a passed sunset's day as given, with the year when it isn't the demo clock's", () => {
    const html = renderToStaticMarkup(
      <StatusBadge
        state="superseded"
        sunsetDay="2026-12-29"
        sunsetPassed
        now="2027-01-10T12:00:00.000Z"
      />,
    );
    expect(text(html)).toBe("Superseded· Sunset passed Dec 29, 2026");
  });
});
