import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RailHeader } from "./rail-header";

const noop = () => {};

describe("RailHeader", () => {
  it("is Preview and Variables as tabs, with the shown one selected", () => {
    const html = renderToStaticMarkup(<RailHeader value="variables" onChange={noop} onClose={noop} />);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>(?:(?!<button).)*Variables/);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>(?:(?!<button).)*Preview/);
  });

  it("is 44px with the hairline under it, whatever it holds", () => {
    const html = renderToStaticMarkup(
      <RailHeader value="preview" onChange={noop} onClose={noop}>
        <button>Typical customer</button>
      </RailHeader>,
    );
    const row = /<div data-slot="rail-header" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(row).toContain("h-11");
    expect(row).toContain("border-b");
    expect(row).toContain("border-hairline");
  });

  it("holds the rail's own control at the right, and a Close button at the far end for the overlay", () => {
    const html = renderToStaticMarkup(
      <RailHeader value="preview" onChange={noop} onClose={noop}>
        <button>Typical customer</button>
      </RailHeader>,
    );
    expect(html).toMatch(/data-slot="rail-header-end"[^>]*>(?:(?!<\/div>).)*Typical customer/);
    expect(html.indexOf("Typical customer")).toBeLessThan(html.indexOf('aria-label="Close"'));
    // Close shows only below the rail's breakpoint.
    expect(html).toMatch(/aria-label="Close"[^>]*class="[^"]*@min-\[53rem\]\/ws:hidden/);
  });
});
