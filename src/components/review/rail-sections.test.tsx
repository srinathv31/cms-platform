import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContractChange } from "@/domain/types";
import { ContractSection } from "./rail-sections";

describe("ContractSection", () => {
  const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  it("says 'First version.' for a first version with nothing to compare, and 'No contract changes.' otherwise", () => {
    expect(text(renderToStaticMarkup(<ContractSection changes={[]} lines={[]} first />))).toBe("Contract changes First version.");
    expect(text(renderToStaticMarkup(<ContractSection changes={[]} lines={[]} />))).toBe("Contract changes No contract changes.");
  });

  it("lists the lines (the first-version wording never hides a change), flagging a breaking one", () => {
    const changes: ContractChange[] = [{ kind: "added", key: "annual_fee", breaking: true, type: "currency", required: true }];
    const markup = renderToStaticMarkup(<ContractSection changes={changes} lines={["v1 adds required `annual_fee` (Currency)."]} first />);
    expect(markup).not.toContain("First version.");
    expect(markup).toContain("annual_fee");
    expect(markup).toContain('aria-label="Breaking"');
  });
});
