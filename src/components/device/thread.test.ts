import { describe, expect, it } from "vitest";
import { showsStamp, threadMessages } from "./thread";

describe("threadMessages", () => {
  it("is the earlier texts, oldest first, then the newest", () => {
    const content = {
      sender: "26725",
      text: "Third",
      time: "2:02 PM",
      earlier: [
        { text: "First", time: "9:41 AM", day: "Yesterday" },
        { text: "Second", time: "9:41 AM", day: "Yesterday" },
      ],
    };
    expect(threadMessages(content).map((m) => m.text)).toEqual(["First", "Second", "Third"]);
    expect(threadMessages({ sender: "26725", text: "Only", time: "9:41 AM" })).toEqual([{ text: "Only", time: "9:41 AM", day: undefined }]);
  });
});

describe("showsStamp", () => {
  it("prints the first time, and each one that differs from the text before (no day is Today)", () => {
    const messages = [
      { text: "a", time: "9:41 AM", day: "Yesterday" },
      { text: "b", time: "9:41 AM", day: "Yesterday" },
      { text: "c", time: "2:02 PM" },
      { text: "d", time: "2:02 PM", day: "Today" },
    ];
    expect(messages.map((_, i) => showsStamp(messages, i))).toEqual([true, false, true, false]);
  });
});
