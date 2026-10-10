// @vitest-environment happy-dom
// A message the route would refuse: its sentence shows above the phone but is no live region (it has the
// live size in it, so it changes with each keystroke). A polite region says a fixed sentence once, when
// the message turns refused, and nothing more while it stays refused.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmsContent } from "@/components/device";
import { INITIAL_PHONE } from "@/components/workspace/session/session-store";
import { smsTooLong } from "@/domain/render/errors";
import type { RenderError } from "@/domain/render/types";
import { refusalNotice, type MessageOutput } from "./message-preview";
import { SmsOutput } from "./phone-output";

// The phone kit loads its fonts through next/font; the well's part is what is around the phone.
vi.mock("@/components/device", () => ({
  SmsPreview: ({ content }: { content: SmsContent }) => <figure data-phone="sms">{content.text}</figure>,
  PushPreview: () => <figure data-phone="push" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const tooLong = (parts: number): RenderError => smsTooLong({ parts, encoding: "GSM-7", characters: parts * 153 });

function show(refusal: RenderError | null) {
  const output: Extract<MessageOutput, { kind: "sms" }> = { kind: "sms", text: "Hi Maya.", refusal };
  act(() =>
    root.render(
      <SmsOutput output={output} settings={INITIAL_PHONE} senders={{ appName: "Coral", smsSender: "26725" }} clock={{ time: "9:41", date: "Friday, October 9" }} />,
    ),
  );
}

const sentence = () => container.querySelector('[data-slot="message-refusal"]');
const status = () => container.querySelector('[role="status"]');

describe("a refused message's sentence", () => {
  it("is shown, but never as an alert", () => {
    show(tooLong(11));
    expect(sentence()?.textContent).toBe("The SMS is 11 parts in GSM-7. It can be at most 10 parts.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("is announced once, in fixed words, when the message turns refused, and not again as it grows", () => {
    show(null);
    expect(status()?.textContent).toBe("");
    show(tooLong(11));
    expect(status()?.textContent).toBe("The SMS is over 10 parts.");
    const region = status();
    show(tooLong(12));
    expect(sentence()?.textContent).toContain("12 parts");
    expect(status()).toBe(region);
    expect(status()?.textContent).toBe("The SMS is over 10 parts.");
    show(null);
    expect(status()?.textContent).toBe("");
    show(tooLong(11));
    expect(status()?.textContent).toBe("The SMS is over 10 parts.");
  });

  it("says nothing for a message that opens already refused", () => {
    show(tooLong(11));
    expect(status()?.textContent).toBe("");
  });
});

describe("refusalNotice", () => {
  it("names the limit, not the message's size", () => {
    expect(refusalNotice(tooLong(14))).toBe("The SMS is over 10 parts.");
    expect(refusalNotice({ code: "push_payload_too_large", message: "The push is 4,321 bytes on iPhone. It can be at most 4,096 bytes." })).toBe(
      "The push is over 4,096 bytes.",
    );
  });
});
