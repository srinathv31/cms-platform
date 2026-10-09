import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveIndicator, saveIndicatorText } from "./save-indicator";

describe("saveIndicatorText", () => {
  it("reads Saved, then Saving…, then Saved", () => {
    expect(saveIndicatorText("saved")).toBe("Saved");
    expect(saveIndicatorText("saving")).toBe("Saving…");
    expect(saveIndicatorText("saved")).toBe("Saved");
  });

  it("reads the same while waiting to save, so a screen reader hears one change per burst", () => {
    expect(saveIndicatorText("unsaved")).toBe(saveIndicatorText("saving"));
  });

  it("shows the error message, with a plain fallback", () => {
    expect(saveIndicatorText("error", "Not saved. Retrying…")).toBe("Not saved. Retrying…");
    expect(saveIndicatorText("error")).toBe("Not saved.");
  });
});

describe("SaveIndicator", () => {
  const html = (props: Parameters<typeof SaveIndicator>[0]) => renderToStaticMarkup(<SaveIndicator {...props} />);

  it("is a polite live region", () => {
    const out = html({ status: "saved" });
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("Saved");
  });

  it("is quiet text: muted, 13px, no icon or spinner", () => {
    const out = html({ status: "saving" });
    expect(out).toContain("text-text-muted");
    expect(out).toContain("text-[13px]");
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("animate-");
  });

  it("marks an error so it isn't missed", () => {
    const out = html({ status: "error", error: "Your latest changes can't be saved — this draft changed elsewhere." });
    expect(out).toContain("text-danger-text");
    expect(out).not.toContain("text-text-muted");
    expect(out).toContain("this draft changed elsewhere");
  });

  it("keeps rendering the region so the next change is announced", () => {
    expect(html({ status: "unsaved" })).toContain("Saving…");
    expect(html({ status: "saved", className: "ml-2" })).toContain("ml-2");
  });
});
