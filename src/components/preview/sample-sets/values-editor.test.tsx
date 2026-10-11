// @vitest-environment happy-dom
// The values editor's inputs stop at the value limit (handoff review N7): the 1,000 characters the
// render route and autosave accept, so a sample is never typed past the point where it is refused.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SampleSet, Variable } from "@/editor/model/types";
import { MAX_VALUE_LENGTH } from "@/editor/model/variables";
import { ValuesEditor } from "./values-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VARIABLES: Variable[] = [
  { key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" },
  { key: "annual_fee", label: "Annual fee", type: "currency", required: true, sample: "95" },
  { key: "home_state", label: "Home state", type: "us_state", required: true, sample: "NJ" },
];
const SET: SampleSet = { id: "holiday", name: "Holiday promo", values: {} };

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ValuesEditor", () => {
  it("limits every value input to 1,000 characters", async () => {
    await act(async () =>
      root.render(
        <ValuesEditor
          set={SET}
          sets={[SET]}
          variables={VARIABLES}
          today="2026-10-04"
          editable
          focusName={false}
          onChange={() => {}}
          onDelete={() => {}}
        />,
      ),
    );
    const inputs = [...container.querySelectorAll<HTMLInputElement>("[role='group'] input")];
    expect(inputs).toHaveLength(VARIABLES.length);
    for (const input of inputs) expect(input.maxLength).toBe(MAX_VALUE_LENGTH);
    expect(MAX_VALUE_LENGTH).toBe(1000);
  });
});
