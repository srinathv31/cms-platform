import { describe, expect, it } from "vitest";
import { quotedTail, roundToWord, truncationWarnings, type FieldCut, type LockScreenFit } from "./truncation";

const whole = (visibleText: string): FieldCut => ({ shown: true, cut: false, visibleText });
const cut = (visibleText: string): FieldCut => ({ shown: true, cut: true, visibleText });
const hidden: FieldCut = { shown: false, cut: false, visibleText: "" };

const TEXT = {
  title: "Your payment is due on Wednesday, October 14",
  subtitle: "Coral Rewards card ending 4821",
  body: "Hi Maya, your minimum payment of $35.00 is due Wednesday, October 14. Pay in the app.",
};

const ios = (fit: Partial<Omit<LockScreenFit, "platform">> = {}): LockScreenFit => ({
  platform: "ios",
  title: whole(TEXT.title),
  subtitle: whole(TEXT.subtitle),
  body: whole(TEXT.body),
  ...fit,
});
const android = (fit: Partial<Omit<LockScreenFit, "platform">> = {}): LockScreenFit => ({
  platform: "android",
  title: whole(TEXT.title),
  subtitle: null,
  body: whole(TEXT.body),
  ...fit,
});

describe("truncationWarnings", () => {
  it("says nothing when nothing that matters is cut", () => {
    expect(truncationWarnings([ios(), android()], TEXT)).toEqual({ title: null, subtitle: null, body: null });
  });

  it("warns when the iPhone lock screen cuts the body, at the last whole word", () => {
    const warnings = truncationWarnings([ios({ body: cut("Hi Maya, your minimum payment of $35.00 is du") })], TEXT);
    expect(warnings.body).toBe("iPhone lock screen cuts after “…$35.00 is”.");
  });

  it("doesn't warn about Android's one-line body: that is how Android shows it", () => {
    const warnings = truncationWarnings([android({ body: cut("Hi Maya, your minimum payment") })], TEXT);
    expect(warnings.body).toBeNull();
  });

  it("warns about a title cut on either platform, naming it", () => {
    expect(truncationWarnings([android({ title: cut("Your payment is due on Wedn") })], TEXT).title).toBe(
      "Android lock screen cuts after “…is due on”.",
    );
    expect(truncationWarnings([ios({ title: cut("Your payment is due on Wednesday,") })], TEXT).title).toBe(
      "iPhone lock screen cuts after “…on Wednesday”.",
    );
  });

  it("names both platforms once when they cut the title at the same word, and each when they don't", () => {
    const same = truncationWarnings([ios({ title: cut("Your payment is due on Wed") }), android({ title: cut("Your payment is due on We") })], TEXT);
    expect(same.title).toBe("iPhone and Android lock screens cut after “…is due on”.");
    const apart = truncationWarnings([ios({ title: cut("Your payment is due on Wednesday, Oc") }), android({ title: cut("Your payment is du") })], TEXT);
    expect(apart.title).toBe("iPhone lock screen cuts after “…on Wednesday”. Android lock screen cuts after “…payment is”.");
  });

  it("warns about the subtitle on iPhone, and ignores a field the screen doesn't show", () => {
    expect(truncationWarnings([ios({ subtitle: cut("Coral Rewards card endi") })], TEXT).subtitle).toBe(
      "iPhone lock screen cuts after “…Rewards card”.",
    );
    expect(truncationWarnings([ios({ title: hidden, body: hidden })], TEXT)).toEqual({ title: null, subtitle: null, body: null });
  });
});

describe("roundToWord", () => {
  it("drops a word the cut splits, and keeps one it doesn't", () => {
    expect(roundToWord("payment of $35", "payment o")).toBe("payment");
    expect(roundToWord("payment of $35", "payment of")).toBe("payment of");
    expect(roundToWord("payment of $35", "payment of ")).toBe("payment of");
  });

  it("keeps a first word that is itself cut, and a text that isn't the start of the full one", () => {
    expect(roundToWord("Supercalifragilistic", "Supercali")).toBe("Supercali");
    expect(roundToWord("Hello there", "Other")).toBe("Other");
  });
});

describe("quotedTail", () => {
  it("quotes the last two words, three when two are short, with an ellipsis before more", () => {
    expect(quotedTail("Hi Maya, your minimum payment of")).toBe("“…payment of”");
    expect(quotedTail("Your payment is due")).toBe("“…payment is due”");
    expect(quotedTail("Payment due")).toBe("“Payment due”");
  });

  it("ends at the word, not at a comma or dash the cut left", () => {
    expect(quotedTail("Payment due November 9,")).toBe("“…November 9”");
    expect(quotedTail("Pay now –")).toBe("“Pay now”");
  });
});
