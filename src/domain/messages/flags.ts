// What the message composer underlines in a channel field's text, and why: the two submit rules that
// hold for the text the author typed, whatever the values (`messageRefusal` in lifecycle.ts, rules 1
// and 3), found where they sit so the author can fix them in place.
//
//   - A character outside GSM-7 in an SMS field. Submit refuses it. When it has an obvious GSM-7
//     equivalent (’ to ', – to -, a no-break space to a space), the flag carries the one-click fix; an
//     invisible one is removed (`replacement` is ""). A letter or an emoji is only flagged: changing it
//     changes the author's words.
//   - A link on a public URL shortener in a field that refuses them (`refusesShorteners`: a push body,
//     an SMS). Submit refuses it, and there is no fix to offer: the author picks their own link.
//
// The text is `typedText(field)`: the field's text, each variable chip a space (a value isn't the
// author's text) and each line break "\n". Offsets are UTF-16, as `String.prototype.slice` takes them.

import type { ChannelField } from "../channel-fields";
import { characterLabel } from "../render/errors";
import { nonGsmCharacters } from "./gsm7";
import { findPublicShorteners } from "./links";

export interface MessageFlag {
  /** Where the flagged text starts in the field's typed text (UTF-16). */
  index: number;
  /** Its length in UTF-16 code units. */
  length: number;
  kind: "character" | "shortener";
  /** The sentence the author reads at the flag: "’ isn't in the SMS character set." */
  message: string;
  /**
   * A character's GSM-7 equivalent, which a one-click fix writes in its place. "" means the fix removes
   * it (an invisible character). Absent: no fix (a letter, an emoji, a link).
   */
  replacement?: string;
}

/** The flags in one field's typed text, in order. Empty for a field that has none of these rules. */
export function messageFieldFlags(field: Pick<ChannelField, "channel" | "refusesShorteners">, text: string): MessageFlag[] {
  const flags: MessageFlag[] = [];
  if (field.channel === "sms") {
    for (const c of nonGsmCharacters(text)) {
      flags.push({
        index: c.index,
        length: c.length,
        kind: "character",
        message: `${characterLabel(c.char)} isn't in the SMS character set.`,
        ...(c.replacement === undefined ? {} : { replacement: c.replacement }),
      });
    }
  }
  if (field.refusesShorteners) {
    for (const link of findPublicShorteners(text)) {
      flags.push({
        index: link.index,
        length: link.length,
        kind: "shortener",
        message: `${link.domain} is a public link shortener carriers filter. Use a link on your own domain.`,
      });
    }
  }
  return flags.sort((a, b) => a.index - b.index);
}
