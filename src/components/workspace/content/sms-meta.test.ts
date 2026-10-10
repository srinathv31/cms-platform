import { describe, expect, it } from "vitest";
import { channelFieldValues } from "@/domain/channel-fields";
import type { JSONContent, SampleSet, Variable } from "@/domain/types";
import { smsMeta, smsMetaSegments, type SmsMetaInput } from "./sms-meta";

const VARIABLES: Variable[] = [{ key: "first_name", label: "First name", type: "text", required: true, sample: "Maya" }];
const FOOTER = "Reply STOP to opt out."; // 22 characters

/** "{{first_name}}" then `n` x's: with Maya and the footer, 4 + n + 1 + 22 characters. */
function fields(n: number) {
  const text: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "variable", attrs: { key: "first_name" } }, { type: "text", text: "x".repeat(n) }] }],
  };
  return channelFieldValues({ sms: { text } });
}

const LONG: SampleSet = { id: "long", name: "Long", values: { first_name: "Alexandria-Marguerite" } }; // 21 characters

function input(over: Partial<SmsMetaInput> = {}): SmsMetaInput {
  return {
    fields: fields(133), // Maya: exactly 160, one part; the long name: 177, two
    variables: VARIABLES,
    values: { first_name: "Maya" },
    sampleSets: [LONG],
    today: "2026-10-09",
    rules: { smsFooter: FOOTER, smsMaxParts: 3 },
    ...over,
  };
}

describe("smsMeta", () => {
  it("measures the SMS as sent, footer included, with the selected set and with the long values", () => {
    const meta = smsMeta(input());
    expect(meta).toEqual({
      current: { encoding: "GSM-7", parts: 1, over: false },
      long: { encoding: "GSM-7", parts: 2, over: false },
      maxParts: 3,
    });
    expect(smsMetaSegments(meta)).toEqual([
      { text: "GSM-7 · 1 part", over: false },
      { text: "Long values: 2 parts", over: false },
    ]);
  });

  it("puts the footer in the count: one character over 160 is two parts", () => {
    expect(smsMeta(input({ fields: fields(134) })).current).toEqual({ encoding: "GSM-7", parts: 2, over: false });
    expect(smsMeta(input({ rules: { smsFooter: null, smsMaxParts: 3 } })).current?.parts).toBe(1);
  });

  it("reports a value that switches the SMS to UCS-2, as the API will", () => {
    expect(smsMeta(input({ values: { first_name: "Óscar" } })).current).toEqual({ encoding: "UCS-2", parts: 3, over: false });
  });

  it("over the content type's budget, says so in the long values' half, in the warning colour", () => {
    const meta = smsMeta(input({ rules: { smsFooter: FOOTER, smsMaxParts: 1 } }));
    expect(smsMetaSegments(meta)).toEqual([
      { text: "GSM-7 · 1 part", over: false },
      { text: "Long values: 2 parts, over the 1-part limit", over: true },
    ]);
  });

  it("leaves out a half whose values don't render", () => {
    expect(smsMetaSegments(smsMeta(input({ values: { first_name: "" } })))).toEqual([{ text: "Long values: 2 parts", over: false }]);
    const broken: SampleSet = { id: "long", name: "Long", values: { first_name: "x".repeat(1001) } };
    expect(smsMetaSegments(smsMeta(input({ sampleSets: [broken] })))).toEqual([{ text: "GSM-7 · 1 part", over: false }]);
  });

  it("measures the long values the version doesn't store from the generated set, as submit does", () => {
    expect(smsMeta(input({ sampleSets: [] })).long).toEqual({ encoding: "GSM-7", parts: 2, over: false });
  });
});
