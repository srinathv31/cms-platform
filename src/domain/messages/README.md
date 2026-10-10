# `src/domain/messages`: what a text message or push notification costs

The measurements behind the message channels, Push and SMS: which characters an SMS can carry, how many parts it
is sent in, how many bytes a push payload weighs, and whether a text links through a public shortener. Facts in,
numbers out. They are written for the composer to run on every keystroke and for Submit, render and `/api/v1` to run
on the server, so that the numbers an author sees are the numbers a consumer gets.

They follow the [domain rules](../README.md#rules): pure TypeScript, no clock, no framework, safe in the browser.
They use two built-ins, `Intl.Segmenter` (grapheme clusters) and `String.prototype.normalize`.

## Modules

| Module | Answers | Exports |
| --- | --- | --- |
| [gsm7.ts](gsm7.ts) | Is this SMS GSM-7 or UCS-2? How many units, characters and parts? Where are the parts cut? Which characters are outside GSM-7, and what can replace them? | `smsEncoding`, `smsLength`, `smsParts`, `nonGsmCharacters`, `gsm7Septets`, the two tables, the limits |
| [push.ts](push.ts) | What JSON does a push send on iOS and on Android, and how many UTF-8 bytes is it? | `pushPayload`, `pushPayloadBytes`, `utf8ByteLength`, `PUSH_MAX_BYTES`, `PUSH_PLATFORMS` |
| [links.ts](links.ts) | Does this text contain a link on a public URL shortener, and where? | `findPublicShorteners`, `PUBLIC_SHORTENER_DOMAINS` |

## Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `GSM7_SINGLE_PART` | 160 | GSM-7 septets in a one-part SMS: 140 octets × 8 ÷ 7. |
| `GSM7_PER_PART` | 153 | GSM-7 septets in each part of a split SMS: 6 octets go to the concatenation header. |
| `UCS2_SINGLE_PART` | 70 | UTF-16 code units in a one-part UCS-2 SMS: 140 octets ÷ 2. |
| `UCS2_PER_PART` | 67 | UTF-16 code units in each part of a split UCS-2 SMS. |
| `SMS_MAX_PARTS` | 10 | The most parts render produces. Past it, render refuses; it never truncates. |
| `PUSH_MAX_BYTES` | 4096 | The payload limit on APNs and FCM. Past it, render refuses. |

## SMS: characters and parts

- **GSM-7 or UCS-2.** A text is GSM-7 when every character is in the GSM 7-bit default alphabet (127 characters, 1
  septet each) or its extension table (form feed, `^ { } \ [ ~ ] |` and €, 2 septets each). One character outside
  them switches the whole message to UCS-2: é stays GSM-7, but á, ’ or an emoji does not. A single ’ turns a
  140-character message from 1 part into 3 (140 units at 67 a part).
- **`units`** is what fills the parts and is billed: septets in GSM-7, UTF-16 code units in UCS-2 (an emoji outside
  the Basic Multilingual Plane is 2). **`characters`** is what a reader counts: grapheme clusters, so a ZWJ emoji
  sequence, a flag and a CRLF are 1 each. **`remainingInPart`** is the units left before another part starts.
- **Where parts are cut.** One part holds 160 septets or 70 units; once split, each holds 153 or 67. A part ends
  before a character that doesn't fit, and nothing is cut in two: an extension character stays with its escape, a
  surrogate pair stays whole, and in UCS-2 a grapheme cluster stays whole. So `parts` can be one more than
  `units ÷ perPart` suggests: 152 letters, a €, and 152 more letters are 306 septets but 3 parts.
- **The empty text** is GSM-7 with 0 parts.
- **Characters outside GSM-7** come back from `nonGsmCharacters` one grapheme cluster at a time, with the UTF-16
  offset and length the editor needs to underline it. Punctuation and spacing with an obvious GSM-7 equivalent get a
  `replacement`: ‘ ’ ‚ ′ ´ to ', “ ” „ ″ « » to ", the hyphens, dashes and minus to -, … to ..., bullets to -, no-break
  and other Unicode spaces to a space, and invisible characters (zero-width space, soft hyphen, a stray joiner) to
  nothing. That last one is the empty string, so test `replacement !== undefined`. Letters (á í ó ú ç), emoji,
  symbols (™ ©) and fractions (1½ would read 11/2) get none: changing them changes the author's words. A letter typed
  in decomposed form (e plus a combining acute) is offered its composed form (é), which is the same text.

### 0x09: Ç, not ç

3GPP TS 23.038 prints Ç (capital) at 0x09. Unicode's GSM0338.TXT maps 0x09 to ç (small), reading the capital as a
display limitation. Android's `GsmAlphabet` decodes 0x09 as Ç, and Twilio's calculator encodes only Ç and counts ç
as UCS-2. So only Ç is GSM-7 here, and ç is flagged like any other letter outside the set. Treating ç as GSM-7 would
either undercount parts (Twilio sends it as UCS-2) or show the reader Ç (a gateway that sends ç as 0x09 to an
Android phone).

### Checked against Twilio's calculator

Twilio's open-source [segment calculator](https://github.com/TwilioDevEd/message-segment-calculator) is the
reference for how a provider splits a message. When this module was written, it agreed with the calculator on the
encoding, units, part count and text of every part for 40,000 generated texts, and on the part count for every
repeat from 1 to 199 of each awkward character (€, ’, an emoji, a ZWJ sequence, a decomposed letter, CRLF). The
differences are deliberate:

- The empty text has 0 parts; the calculator reports 1 segment.
- A grapheme cluster longer than a whole part (over 67 units, only reachable with a pathological run of combining
  marks or joiners) splits between code points here; the calculator overfills a part with it.
- `characters` always counts grapheme clusters. The calculator's `numberOfCharacters` counts septets for GSM-7.
- Clusters come from the runtime's `Intl.Segmenter`. The calculator uses the `grapheme-splitter` package, whose
  older Unicode rules can join a newer emoji sequence differently.

Consumers must turn off provider rewriting such as Twilio's Smart Encoding, which replaces ’ – … with ASCII before
sending: the counts here are for the text exactly as rendered.

## Push: payload size

`pushPayload` builds the JSON Stencil's text makes: `{"aps":{"alert":{"title","subtitle","body"}}}` for APNs and
`{"message":{"notification":{"title","body"}}}` for FCM HTTP v1. Android never carries a subtitle, and an empty
subtitle is left out on iOS too. `pushPayloadBytes` is the UTF-8 length of that JSON as `JSON.stringify` writes it:
compact, non-ASCII as raw UTF-8 (é 2 bytes, ’ and € 3, an emoji 4), and only `"`, `\` and control characters
escaped (a line break is the 2 bytes `\n`).

The number is a **lower bound** on what a consumer sends. It counts only Stencil's text. The consumer's own keys (a
deep link, a data payload, badge, sound, category, thread id) add to it, so their payload is `pushPayloadBytes` plus
the bytes of their keys, and they have `PUSH_MAX_BYTES − pushPayloadBytes` left for them. Device tokens aren't in
the count, and don't need to be: APNs takes the token in the request path, and FCM's limit counts the payload's keys
and values. On Android the count does include the request's `message` envelope, which FCM may not count against
the limit, so there it errs a few bytes high: the safe side. Two caveats for consumers:

- A serializer that escapes non-ASCII as `\uXXXX` (Python's `json.dumps` by default) makes é 6 bytes and an emoji
  12, so it can take a payload Stencil measured as fitting over the limit.
- An FCM message sent to a topic has 2,048 bytes, not 4,096.

## Links: public shorteners

CTIA's Messaging Principles and Best Practices (May 2023), §5.3.2 Embedded Website Links: where a URL shortener is
used, senders "should use a shortener with a web address and IP address(es) dedicated to the exclusive use of the
Message Sender". A public shortener's domain is shared by every sender, spammers included: it hides whose link it
is, and US carriers and 10DLC campaign vetting filter messages that use one. A sender's own branded short domain is
fine.

`findPublicShorteners` returns each link on a listed domain or a subdomain of one, with or without a scheme, with its
UTF-16 offset and length, through its path and without trailing punctuation. It scans the whole text, so a shortener
inside another link's query is found too. A host that only resembles one doesn't match: `bit.lyrics.com`,
`notbit.ly`, `goo.gle`. The list is curated, not exhaustive: the best-known general-purpose shorteners, plus the
services that wrap every link their users post (t.co, lnkd.in).

## Sources

- 3GPP TS 23.038 §6.2.1 and §6.2.1.1: the GSM 7-bit default alphabet and its extension table.
- Unicode, [GSM0338.TXT](https://www.unicode.org/Public/MAPPINGS/ETSI/GSM0338.TXT), table version 2.0: every entry
  checked, and transcribed again in [gsm7.test.ts](gsm7.test.ts) to check the table in code.
- 3GPP TS 23.040 §9.2.3.24.1: the 6-octet concatenation header.
- Android's `GsmAlphabet` (AOSP `frameworks/base`, `telephony/common`): the same default and extension tables, with Ç
  at 0x09.
- Twilio's [message-segment-calculator](https://github.com/TwilioDevEd/message-segment-calculator): the split
  cross-check above.
- Apple, [Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns):
  the payload is limited to 4 KB (4,096 bytes).
- Firebase, [FCM error codes](https://firebase.google.com/docs/cloud-messaging/error-codes): 4,096 bytes for most
  messages, 2,048 for topic messages, keys and values included.
- CTIA, Messaging Principles and Best Practices (May 2023), §5.3.2.
