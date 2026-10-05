import { describe, expect, it } from "vitest";
import { resolveRailView } from "./rail-view";
import { INITIAL_PREVIEW, type PreviewState } from "./session-store";

const closed: PreviewState = INITIAL_PREVIEW;
const open = (view: PreviewState["view"]): PreviewState => ({ ...INITIAL_PREVIEW, open: true, view });
const waiting = { has: true, preferred: true };
const resolvedOnly = { has: true, preferred: false };
const none = { has: false, preferred: false };

describe("resolveRailView", () => {
  it("opens on Comments while something is waiting there, and on Variables otherwise", () => {
    expect(resolveRailView(closed, null, waiting)).toBe("comments");
    expect(resolveRailView(closed, null, resolvedOnly)).toBe("variables");
  });

  it("follows the author's pick over what is waiting", () => {
    expect(resolveRailView(closed, "variables", waiting)).toBe("variables");
    expect(resolveRailView(closed, "comments", resolvedOnly)).toBe("comments");
  });

  it("is the normal rail when there are no comments, whatever was picked", () => {
    expect(resolveRailView(closed, "comments", none)).toBe("variables");
    expect(resolveRailView(open("comments"), null, none)).toBe("variables");
  });

  it("shows the widened rail's own view while the preview is open", () => {
    expect(resolveRailView(open("preview"), "comments", waiting)).toBe("preview");
    expect(resolveRailView(open("comments"), "variables", waiting)).toBe("comments");
    expect(resolveRailView(open("variables"), "comments", waiting)).toBe("variables");
  });
});

describe("resolveRailView: the imported original", () => {
  it("shows the Original view while the widened rail is on it", () => {
    expect(resolveRailView(open("original"), null, none, true)).toBe("original");
    expect(resolveRailView(open("original"), "comments", waiting, true)).toBe("original");
  });

  it("is the normal rail when the template has no original", () => {
    expect(resolveRailView(open("original"), null, none)).toBe("variables");
  });

  it("is never the plain rail's view: putting the rail away goes back to Comments or Variables", () => {
    expect(resolveRailView({ ...open("original"), open: false }, null, waiting, true)).toBe("comments");
    expect(resolveRailView({ ...open("original"), open: false }, null, none, true)).toBe("variables");
  });
});
