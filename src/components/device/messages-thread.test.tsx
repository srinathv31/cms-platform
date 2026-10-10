import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AndroidMessagesThread } from "./android/messages-thread";
import { MessagesThread } from "./ios/messages-thread";
import { NO_SENDER } from "./labels";
import type { DeviceClock, DeviceSettings, SmsContent } from "./types";

// The thread's header names the sender: the short code, or a neutral placeholder when the text has none,
// never an empty pill (iOS) or an empty name (Android).

// The kit loads its faces through next/font, which only runs in a Next build.
vi.mock("./fonts", () => ({ deviceFontVariables: "" }));

const DEFAULT_CLOCK: DeviceClock = { time: "9:41", date: "Friday, October 9" };

const SETTINGS: Omit<DeviceSettings, "platform"> = { appearance: "light", previewsHidden: false, textSize: "default", width: "standard" };
const TEXT: SmsContent = { sender: "26725", text: "Hi Maya, your payment is due.", time: "9:41 AM" };

const THREADS = {
  ios: (content: SmsContent) => <MessagesThread content={content} settings={{ platform: "ios", ...SETTINGS }} clock={DEFAULT_CLOCK} />,
  android: (content: SmsContent) => <AndroidMessagesThread content={content} settings={{ platform: "android", ...SETTINGS }} clock={DEFAULT_CLOCK} />,
};

/** The header's sender element: its attributes and text. */
function senderOf(html: string): { placeholder: boolean; text: string } {
  const match = /<span([^>]*data-slot="sms-sender"[^>]*)>([^<]*)<\/span>/.exec(html);
  if (!match) throw new Error("no sender in the header");
  return { placeholder: match[1]!.includes("data-placeholder"), text: match[2]! };
}

describe("the thread's sender", () => {
  for (const [platform, thread] of Object.entries(THREADS)) {
    it(`shows the short code on ${platform}`, () => {
      expect(senderOf(renderToStaticMarkup(thread(TEXT)))).toEqual({ placeholder: false, text: "26725" });
    });

    it(`shows a neutral placeholder on ${platform} when the text has no sender`, () => {
      for (const sender of ["", "   "]) {
        expect(senderOf(renderToStaticMarkup(thread({ ...TEXT, sender })))).toEqual({ placeholder: true, text: NO_SENDER });
      }
    });
  }
});
