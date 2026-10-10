import { describe, expect, it } from "vitest";
import { plural, pluralName, pluralWord, withArticle } from "./plural";

describe("plural", () => {
  it("puts the count before the noun, singular only for one", () => {
    expect(plural(0, "version")).toBe("0 versions");
    expect(plural(1, "version")).toBe("1 version");
    expect(plural(3, "version")).toBe("3 versions");
    expect(plural(2, "repeated header or footer line")).toBe("2 repeated header or footer lines");
  });

  it("takes an irregular plural", () => {
    expect(plural(1, "policy", "policies")).toBe("1 policy");
    expect(plural(4, "policy", "policies")).toBe("4 policies");
  });

  it("writes the count the one way counts are written", () => {
    expect(plural(1_204, "render")).toBe("1,204 renders");
  });
});

describe("pluralWord", () => {
  it("is the noun alone", () => {
    expect(pluralWord(1, "variable")).toBe("variable");
    expect(pluralWord(2, "variable")).toBe("variables");
    expect(pluralWord(0, "section")).toBe("sections");
    expect(pluralWord(2, "policy", "policies")).toBe("policies");
  });
});

describe("pluralName", () => {
  it("puts a content type's name in the plural", () => {
    expect(pluralName("Disclosure")).toBe("Disclosures");
    expect(pluralName("Policy")).toBe("Policies");
    expect(pluralName("Survey")).toBe("Surveys");
    expect(pluralName("Notices")).toBe("Notices");
  });
});

describe("withArticle", () => {
  it("puts an before a vowel and a before a consonant", () => {
    expect(withArticle("email subject")).toBe("an email subject");
    expect(withArticle("push title")).toBe("a push title");
  });

  it("reads a word in capitals letter by letter", () => {
    expect(withArticle("SMS message")).toBe("an SMS message");
    expect(withArticle("PDF")).toBe("a PDF");
  });
});
