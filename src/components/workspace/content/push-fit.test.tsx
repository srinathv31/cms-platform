// @vitest-environment happy-dom
// The hidden phones that measure the push's cuts redraw only when the push does: a keystroke in the SMS
// leaves the push's content as it was, and the phones with it.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushContent } from "@/components/device";
import { channelFieldValues, type ChannelFieldValues } from "@/domain/channel-fields";
import type { JSONContent } from "@/domain/types";
import { usePushContent, usePushFit } from "./push-fit";

const drawn = vi.hoisted(() => ({ count: 0 }));

// The phone kit loads its fonts through next/font; what matters here is how often a phone is drawn.
vi.mock("@/components/device", () => ({
  frameSize: () => ({ width: 431, height: 903 }),
  PushPreview: ({ content }: { content: PushContent }) => {
    drawn.count++;
    return <figure>{content.title}</figure>;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  drawn.count = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const doc = (text: string): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
// As the composer has them: the same objects from one render to the next.
const RULES = { smsFooter: null, smsMaxParts: 3 };
const VARIABLES: never[] = [];
const VALUES = {};
const contents: (PushContent | null)[] = [];

function Composer({ fields }: { fields: ChannelFieldValues }) {
  const content = usePushContent({ on: true, fields, variables: VARIABLES, values: VALUES, rules: RULES, appName: "Coral" });
  contents.push(content);
  return <>{usePushFit(content).probe}</>;
}

const show = (fields: ChannelFieldValues) => act(() => root.render(<Composer fields={fields} />));

describe("the phones that measure the push", () => {
  it("aren't redrawn by a keystroke in the SMS, and are by one in the push", () => {
    contents.length = 0;
    const title = doc("Payment due");
    const fields = { ...channelFieldValues({}), "push.title": title, "push.body": doc("Hi Maya."), "sms.text": doc("Hi") };
    show(fields);
    const first = contents.at(-1);
    expect(first).toMatchObject({ appName: "Coral", title: "Payment due", body: "Hi Maya." });
    const drawnFirst = drawn.count;
    expect(drawnFirst).toBe(2);

    // The SMS changes: a new set of fields, the push's own documents as they were.
    show({ ...fields, "sms.text": doc("Hi there") });
    expect(contents.at(-1)).toBe(first);
    expect(drawn.count).toBe(drawnFirst);

    show({ ...fields, "sms.text": doc("Hi there"), "push.title": doc("Payment due Friday") });
    expect(contents.at(-1)).toMatchObject({ title: "Payment due Friday" });
    expect(drawn.count).toBe(drawnFirst + 2);
  });
});
