# 0034. An SMS is written in GSM-7, measured in parts, and never cut or rewritten

Status: Accepted
Date: 2026-10-09

## Context

An SMS carries 140 octets: 160 characters of the GSM 7-bit alphabet, or 70 of UCS-2 (UTF-16) once a single
character is outside it. A longer message goes in parts of 153 or 67, each billed. One curly apostrophe, typed by
habit or pasted from a document, turns a 140-character message from one part into three. Providers "help": Twilio's
Smart Encoding rewrites ’ – … into ASCII before sending, so what the customer gets is not what was approved. And a
customer's own name can hold a character outside GSM-7 ("Gómez"). The render-exact rule says every channel prints
exactly what the author typed and every value as sent.

## Decision

- **The author writes GSM-7.** Submit refuses an SMS whose typed text has a character outside GSM-7, naming each one
  ("Replace ’ and – in the SMS message before submitting."). The composer underlines each and offers a one-click
  replacement when there is an obvious GSM-7 equivalent (’ → ', “ → ", – → -, … → ..., a no-break space → a space);
  letters, emoji and symbols get none, since changing them changes the author's words (`nonGsmCharacters`).
- **Ç, not ç.** 3GPP TS 23.038 prints Ç at 0x09; Unicode's GSM0338.TXT reads it as ç. Android decodes Ç and Twilio's
  calculator counts ç as UCS-2, so only Ç is GSM-7 here. Treating ç as GSM-7 would undercount parts or change the
  letter the reader sees.
- **Values are never transliterated.** A value prints exactly as sent. If it switches the message to UCS-2, the API
  says so (`encoding`, `parts`), and the consumer pays for the parts.
- **A message keeps its invisible characters.** A document drops the zero-width and format characters, because the
  editor shows nothing for them and a PDF font can't draw them. A phone draws with them: the joiner in 👨‍👩‍👧, the
  emoji selector in ❤️ and 1️⃣, a subdivision flag's tags, the non-joiner Persian and Indic names are spelled with.
  So a push's and an SMS's fields, and the values they print, lose only control characters, at save and at render
  (docs/render-spec.md §4). In an SMS the author's own invisible characters are still outside GSM-7: flagged, with a
  one-click removal, and refused at submit; in a value they print as sent.
- **Render never truncates.** It refuses only what can't be delivered at all: an SMS over 10 parts
  (`sms_too_long`, `SMS_MAX_PARTS`). Twilio accepts about 1,600 characters, so 10 parts is a product limit, set where
  a text stops being a text.
- **Submit holds a budget.** Each message content type has a part budget (`content_types.sms_max_parts`, 3 unless
  set); submit measures the SMS with the draft's "long" sample values and the content type's footer, and refuses it
  over the budget. Typical values usually fit in fewer. A stored long value that no longer validates (the set was
  edited before its variable changed type) gives way to the generated long value for that key, in submit and in the
  composer's "Long values" line alike, so a stale sample set can never switch the budget or the push size check off.
- **The footer counts.** The content type's footer (the brand and "Reply STOP to opt out", which CTIA asks of a US
  sender) is printed on its own last line, exactly as written, and counts toward the parts.
- **No public link shorteners** in an SMS or a push body: carriers filter them (CTIA §5.3.2). A branded short domain
  is fine.
- **Consumers turn off Smart Encoding** and any other provider rewriting: the counts are for the text as rendered,
  and the integration page says so.

## Alternatives considered

- **Transliterate values** (Gómez → Gomez) to keep messages in GSM-7. Cheaper, but it changes a customer's name in a
  regulated message: the render-exact rule forbids it.
- **Truncate to the budget.** Drops content a reviewer approved; a cut disclosure or amount is worse than a longer
  message.
- **Accept ç as GSM-7**, as GSM0338.TXT does. Undercounts against the providers' own counting and can change the
  letter on Android.
- **Let Smart Encoding run.** The text sent would differ from the text approved and previewed, and the part counts
  Stencil reports would be wrong in the consumer's favour only by accident.

## Consequences

- A typed curly quote blocks Submit until it is replaced; the composer makes that one click.
- The API's `parts` for a given request can be higher than the composer's estimate with sample values: values decide.
- The character tables and splitting rules (`src/domain/messages/gsm7.ts`) are part of the render specification
  (docs/render-spec.md, "SMS encoding"); a second engine must reproduce them, checked by the golden files.
- **Grapheme clusters are pinned to Unicode 17.0, not taken from the runtime.** A UCS-2 part never splits a cluster
  and `characters` counts them, so the clusters decide the parts. `Intl.Segmenter` follows each runtime's ICU, and
  the rules move between Unicode versions (GB9c, which keeps an Indic conjunct like क्ष whole, arrived in 15.1 and
  changes again in 18.0), so an older browser's preview, the server and a Java engine could each cut a different
  SMS. Two ways out were weighed. Saying "Unicode 15.1 or later" in the specification would have named a range, not a
  version, and left the browser preview free to disagree with the API, which decision
  [0035](0035-message-previews-resolve-in-the-browser.md) forbids. Implementing UAX #29 here, over one version's
  data, keeps all three in agreement in any runtime: `src/domain/messages/graphemes.ts`, with a 6 KB property table
  generated from the Unicode Character Database 17.0.0 (`scripts/unicode-graphemes.ts`) and Unicode's own
  conformance file as its test. 17.0 is the version Node 24's ICU has, so nothing moved when it landed. A Java engine
  uses ICU4J 78 (Unicode 17.0) or ports the module and its table, and runs the same conformance file; the golden
  case `sms-conjunct-at-part-boundary` fails an engine on older rules. Moving to a newer Unicode version is a change
  to the specification, made in every engine at once.
