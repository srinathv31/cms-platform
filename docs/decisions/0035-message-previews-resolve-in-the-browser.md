# 0035. Message previews resolve in the browser, through the render's own function

Status: Accepted
Date: 2026-10-09

## Context

The document channels (PDF, Web, Email) preview through the render route: the preview posts the saved draft's
version and the sample values to `/api/v1/templates/{id}/render` with `preview: true`, and shows what comes back. So
an edit reaches the preview only once autosave has saved it (800 ms after typing stops, at most 5 s), and a
PDF takes a round trip. For a long document that is the right trade: the server owns the PDF fonts and the email
HTML, and the preview is the route's own output.

A push or an SMS is a few hundred characters of plain text. The decisions an author makes while writing one are
small and immediate: does the title fit on the lock screen, did that apostrophe just make the SMS three parts. A
preview that lags the keyboard by a save makes those decisions by trial and error, and a request per keystroke would
fill the network with renders of drafts nobody keeps (and with 4xx responses the console logs as errors). The
message renderer (`renderMessage` in `src/domain/render/message.ts`) is pure TypeScript with no clock, no fonts and no
database: the route's engine and the golden files already run it as is.

## Decision

- **The browser renders Push and SMS itself, on every change**, with `renderMessage`, the same function the route
  runs: the composer's fields as typed (unsaved keystrokes included, held in the page's live draft,
  `workspace/session/live-draft.ts`), the variables as the editor has them, and the selected sample set's values,
  validated first with the route's own `validateValues`. No request is made for a message channel.
  `src/components/preview/message-preview.ts` is the whole of the glue.
- **What shows is what the route would answer.** Values the route would refuse show the route's sentence, as any
  channel's error does. A message the route would refuse (an SMS over 10 parts, a push over 4,096 bytes) still shows
  on the phone, from `resolveMessage` (the same text without the limits), with the route's sentence above it, so the
  author sees what is too long.
- **The review screen does the same** with the version's stored fields: an approver sees, byte for byte, the
  message a consumer will get, without a request.
- **The composer's measurements come from the same functions**: the meta line's encoding and parts
  (`smsLength` on `resolveMessage`), the long values submit uses (`longSampleValues`), the flags in the text
  (`messageFieldFlags`), and the cut warnings, which read the phone kit's own measurement of hidden phones.
- The document channels keep the route.

## Alternatives considered

- **The route, after each save**, as the documents do. The preview would lag typing by a save, and a measurement
  under a field (parts, cuts) would disagree with the text above it until the save landed.
- **The route on every keystroke**, debounced. Still a lag, a request per pause, and the route's 4xx for a draft
  mid-edit logged as console errors.
- **A second, browser-only renderer** for the preview. Two implementations of the render-exact rule drift; the
  golden files would cover only one of them.

## Consequences

- The domain's render code ships to the browser (the message renderer, the resolver, the GSM-7 tables, value
  validation). It must stay pure: no Node APIs, no clock, nothing a browser lacks. `src/domain` already promises this.
- A message preview needs no network and no loading state: the phone is drawn with the text at once, so its
  skeleton is the frame itself.
- When the backend moves to the Java API, the browser still runs the TypeScript renderer for the preview. The
  golden files are what keep the two engines byte for byte the same; a Java change to message output must land with
  the same change here.
- The preview can't catch what only the server knows. Today nothing about a message is: the SMS footer (a draft's
  is the content type's, a submitted version's the one frozen into it), the part budget, and the team's app name and
  short code, come with the page's read model.
- The browser and the server cut an SMS into the same parts because the grapheme clusters are pinned to one Unicode
  version in the domain (`src/domain/messages/graphemes.ts`), not taken from the browser's `Intl.Segmenter`
  ([0034](0034-sms-characters-and-length.md)).
