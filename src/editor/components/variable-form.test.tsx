// @vitest-environment happy-dom
// The variable form's Sample field stops at the value limit (handoff review N7): the 1,000 characters the
// render route and autosave accept.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_VALUE_LENGTH } from "../model/variables";
import { VariableForm } from "./variable-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("VariableForm", () => {
  it("limits the Sample field to 1,000 characters", async () => {
    await act(async () =>
      root.render(
        <VariableForm
          mode="create"
          initial={{ label: "Note", key: "note", type: "text", required: true, sample: "" }}
          takenKeys={new Set()}
          onSubmit={() => ({ ok: true })}
          onCancel={() => {}}
        />,
      ),
    );
    const sample = [...container.querySelectorAll<HTMLInputElement>("input")].find((input) => input.id.endsWith("-sample"));
    expect(sample?.maxLength).toBe(MAX_VALUE_LENGTH);
  });
});
