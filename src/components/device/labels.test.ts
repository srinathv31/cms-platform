import { describe, expect, it } from "vitest";
import { ANDROID_LINES } from "./android/notification-card";
import { IOS_LINES } from "./ios/notification-card";
import { pushScreenLabel, smsCaption } from "./labels";

describe("smsCaption", () => {
  it("names the sender, and leaves out 'from' when there is none", () => {
    expect(smsCaption("ios", "26725")).toBe("Text message from 26725, iOS-style preview");
    expect(smsCaption("android", "26725")).toBe("Text message from 26725, Android-style preview");
    expect(smsCaption("ios", "")).toBe("Text message, iOS-style preview");
    expect(smsCaption("android", "  ")).toBe("Text message, Android-style preview");
  });
});

describe("pushScreenLabel", () => {
  it("calls a banner a heads-up on Android, and keeps the other names", () => {
    expect(pushScreenLabel("ios", "banner")).toBe("Banner");
    expect(pushScreenLabel("android", "banner")).toBe("Heads-up");
    expect(pushScreenLabel("android", "lock")).toBe("Lock screen");
    expect(pushScreenLabel("android", "expanded")).toBe("Expanded");
  });
});

describe("line counts", () => {
  it("cut Android to one line of text where iOS shows four, and never give Android a subtitle", () => {
    expect(IOS_LINES.lock.body).toBe(4);
    expect(ANDROID_LINES.lock.body).toBe(1);
    expect(ANDROID_LINES.banner).toEqual({ title: 1, subtitle: 0, body: 1 });
    expect(Object.values(ANDROID_LINES).every((lines) => lines.subtitle === 0)).toBe(true);
  });
});
