import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IntegrationPanelData } from "@/domain/golive-types";
import { ContractChanges } from "./contract-changes";

type Since = IntegrationPanelData["since"];

const html = (since: Since) => renderToStaticMarkup(<ContractChanges since={since} activeNumber={3} />);

const v2: Since[number] = {
  number: 2,
  state: "superseded",
  sunsetDay: "2026-12-01",
  diff: {
    breaking: true,
    items: [
      { kind: "added", key: "annual_fee", breaking: true, text: "v3 adds required `annual_fee` (Currency)." },
      { kind: "label_changed", key: "purchase_apr", breaking: false, from: "APR", to: "Purchase APR", text: "v3 changes the label of `purchase_apr` to “Purchase APR”." },
    ],
  },
};
const v1: Since[number] = { number: 1, state: "revoked", sunsetDay: null, diff: { breaking: false, items: [] } };

describe("ContractChanges", () => {
  it("names the version, marks breaking items and sets keys in mono", () => {
    const out = html([v2]);
    expect(out).toContain("What changed since v2");
    expect(out.match(/Breaking/g)).toHaveLength(1);
    expect(out).toContain('<code class="font-mono');
    expect(out).toContain("annual_fee");
  });

  it("offers a picker only when there are several older versions, defaulting to the first", () => {
    expect(html([v2])).not.toContain("Compare with version");
    const out = html([v2, v1]);
    expect(out).toContain("Compare with version");
    expect(out).toContain("What changed since v2");
  });

  it("says so when the contract did not change", () => {
    expect(html([v1])).toContain("No contract changes.");
    expect(html([v1])).not.toContain("Breaking");
  });
});
