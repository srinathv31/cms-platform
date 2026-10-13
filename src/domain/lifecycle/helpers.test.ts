import { describe, expect, it } from "vitest";
import { NOTE_MAX, REASON_MAX, noteRefusal, reasonRefusal } from "./helpers";

// The lengths the review commands take: checked behind the seam, after the permission, before the transition.
describe("noteRefusal and reasonRefusal", () => {
  it("measure the text as it is kept: trimmed", () => {
    expect(noteRefusal(`  ${"a".repeat(NOTE_MAX)}  `)).toBeNull();
    expect(reasonRefusal(`  ${"a".repeat(REASON_MAX)}  `)).toBeNull();
    expect(noteRefusal(null)).toBeNull();
    expect(noteRefusal(undefined)).toBeNull();
  });

  it("refuse one character over, with the limit in the sentence", () => {
    expect(noteRefusal("a".repeat(NOTE_MAX + 1))).toEqual({
      code: "note_too_long",
      reason: "Keep the note under 2,000 characters.",
    });
    expect(reasonRefusal("a".repeat(REASON_MAX + 1))).toEqual({
      code: "reason_too_long",
      reason: "Keep the reason under 2,000 characters.",
    });
  });
});
