// The measurement under the composer's SMS message: "GSM-7 · 1 part · Long values: 2 parts". Pure, so
// it tests without a DOM. Both halves measure the SMS as sent, footer included, through the render's
// own functions:
//   - the selected sample set, as the preview shows it: its encoding and parts;
//   - the "long" sample values, the ones submit measures with (`longSampleValues`): their parts, against
//     the content type's budget. Over it, that half reads "…, over the 3-part limit", in the warning
//     colour: submit will refuse it.
// A half whose values don't render is left out (the preview says why).

import { channelFieldsFrom, type ChannelFieldValues } from "@/domain/channel-fields";
import { smsLength, type SmsEncoding } from "@/domain/messages/gsm7";
import type { MessageTypeRules } from "@/domain/platform-config";
import { plural } from "@/domain/plural";
import { longSampleValues, resolveMessage } from "@/domain/render/message";
import type { CanonicalValues } from "@/domain/render/types";
import { validateValues } from "@/domain/render/validate";
import type { SampleSet, Variable, VariableValues } from "@/domain/types";

export interface SmsMeasure {
  encoding: SmsEncoding;
  parts: number;
  /** More parts than the content type allows. */
  over: boolean;
}

export interface SmsMeta {
  /** With the selected sample set's values; null when they don't render. */
  current: SmsMeasure | null;
  /** With the long sample values; null when they don't validate. */
  long: SmsMeasure | null;
  /** The content type's budget of parts. */
  maxParts: number;
}

export interface SmsMetaInput {
  /** The fields as typed. */
  fields: ChannelFieldValues;
  variables: readonly Variable[];
  /** The selected set's values, as the preview resolves them. */
  values: VariableValues;
  /** The sample sets as stored (the long one may be missing: then the generated one counts). */
  sampleSets: readonly SampleSet[];
  /** The demo clock's day, YYYY-MM-DD. */
  today: string;
  rules: MessageTypeRules;
}

export function smsMeta({ fields, variables, values, sampleSets, today, rules }: SmsMetaInput): SmsMeta {
  const stored = channelFieldsFrom(fields);
  const measure = (canonical: CanonicalValues): SmsMeasure => {
    const text = resolveMessage({ channel: "sms" }, { fields: stored, variables, values: canonical, rules });
    const { encoding, parts } = smsLength(text);
    return { encoding, parts, over: parts > rules.smsMaxParts };
  };
  const checked = validateValues(variables, values);
  const long = longSampleValues({ variables, sampleSets }, today);
  return {
    current: checked.ok ? measure(checked.values) : null,
    long: long ? measure(long) : null,
    maxParts: rules.smsMaxParts,
  };
}

/** The line's parts, in order, each in the warning colour when it is over the budget. */
export function smsMetaSegments(meta: SmsMeta): { text: string; over: boolean }[] {
  const segments: { text: string; over: boolean }[] = [];
  if (meta.current) {
    segments.push({ text: `${meta.current.encoding} · ${plural(meta.current.parts, "part")}`, over: meta.current.over });
  }
  if (meta.long) {
    const limit = meta.long.over ? `, over the ${meta.maxParts}-part limit` : "";
    segments.push({ text: `Long values: ${plural(meta.long.parts, "part")}${limit}`, over: meta.long.over });
  }
  return segments;
}
