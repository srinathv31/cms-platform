import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VersionState } from "@/domain/types";
import { ChangeToggles, baselineLabel } from "./view-tabs";

// The change switches' "vs vN" label names the version the redline is against, and, when that isn't the
// Active version (after a revoke, the version the correction started from), its state.

const label = (state: VersionState, number: number) => {
  const html = renderToStaticMarkup(
    <ChangeToggles
      baseline={{ number, state }}
      showChanges
      onShowChanges={() => {}}
      changesOnly={false}
      onChangesOnly={() => {}}
      count={1}
      summary="1 changed"
    />,
  );
  return /<span data-slot="baseline-label"[^>]*>([^<]*)<\/span>/.exec(html)?.[1] ?? null;
};

describe("the change switches' baseline label", () => {
  it("reads \"vs v2\" against the Active version", () => {
    expect(label("active", 2)).toBe("vs v2");
  });

  it("says the version is revoked when the redline is against the revoked version", () => {
    expect(label("revoked", 3)).toBe("vs v3 (revoked)");
  });

  it("says the version is superseded when it falls back to the newest that still renders", () => {
    expect(baselineLabel({ number: 1, state: "superseded" })).toBe("vs v1 (superseded)");
  });

  it("isn't shown until the changes are", () => {
    const html = renderToStaticMarkup(
      <ChangeToggles
        baseline={{ number: 3, state: "revoked" }}
        showChanges={false}
        onShowChanges={() => {}}
        changesOnly={false}
        onChangesOnly={() => {}}
        count={1}
        summary="1 changed"
      />,
    );
    expect(html).not.toContain("baseline-label");
    expect(html).toContain("Show changes");
  });
});
