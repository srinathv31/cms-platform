# 0033. Message channels: Push and SMS, in a family of their own, from a registry of fields

Status: Accepted
Date: 2026-10-09

## Context

Stencil rendered one long body to PDF, Web and Email. Teams also send short regulated messages: a push notification
that a payment is due, a text that a card was used abroad. Those don't fit the body: a push has a title and a body of
a line or two, an SMS is plain text billed per part, and neither can carry a heading, a table or a link mark. Email
already had two short fields of its own (subject and preheader), threaded through about fifteen files as two
columns. Adding push and SMS the same way would have meant three more columns, each touching the same files, and
nothing stopped a long body from flowing into a text message. The owner confirmed the model on 2026-10-09.

## Decision

- **Two families, never mixed.** `CHANNELS` is `pdf`, `web`, `email`, `push`, `sms`. `DOCUMENT_CHANNELS` (PDF, Web,
  Email) render the template's one body; `MESSAGE_CHANNELS` (Push, SMS) render only their own fields and never read a
  body (`channelFamily`, `familyOf` in `src/domain/types.ts`). A content type is one family: `channelRuleRefusal`
  refuses turning on a channel of the other family, with a sentence that names where it goes ("Disclosures are
  documents. Push and SMS go on Alert templates."), and the channel rules matrix shows that switch disabled with it.
  Since one channel always stays on, a content type's family never changes, and so a template's never does. The
  seed's message content type is **Alert** ("Notifications" is already the bell in the header). An Alert has no
  required sections: editing them is refused (`sectionsRefusal`). A letter plus a text heads-up is two templates.
- **The author chooses the kind when making a template.** New template opens on Document · Alert, each kind with its
  own starters. The kind decides the content type (`newTemplateContentType`: the platform's content type of that
  family, the first by name), which the template keeps for life. Import a file makes documents only, so it shows
  disabled, with its reason, while Alert is chosen.
- **A new template's channels come from its family** (`DEFAULT_CHANNELS`, `newTemplateChannels`): PDF and Web for a
  document, Push and SMS for a message.
- **One registry of channel fields** (`CHANNEL_FIELDS` in `src/domain/channel-fields.ts`): each field's key, label,
  name, shape, whether submit requires it, and for push the platforms it shows on. Email: subject and preheader.
  Push: title (required), subtitle (optional, iPhone only), body (required). SMS: message (required). They are stored
  together in `versions.channel_fields`, keyed by channel and then field, and everything that saves, checks, submits
  or renders a field loops over the registry. Three **shapes**: `line` (one line, a typed break becomes a space),
  `paragraph` (no breaks, shown wrapping) and `lines` (hard breaks kept). None takes marks or links.
- **Push is one message for both platforms.** The text is shared; the subtitle is iPhone's alone. `/api/v1` takes
  `platform: "ios" | "android"` with `channel: "push"` (and refuses it with any other channel), and Android's output
  never has a subtitle. The response is the title, subtitle and body in full and `payloadBytes`, the UTF-8 size of
  the APNs or FCM JSON this text makes. The phone cuts what doesn't fit its screen; Stencil never cuts. Over 4,096
  bytes, the render is refused (`push_payload_too_large`).
- **One pure renderer**, `renderMessage` in `src/domain/render/message.ts`, used by the engine's push and SMS
  adapters and, for the live preview, by the browser: what the author sees is byte for byte what a consumer gets.
- **Who a message comes from** is a team fact, not derived like the email preview's sender
  ([0023](0023-the-email-preview-sends-from-stencil.md)): `teams.app_name` over a push and `teams.sms_sender`, the
  short code a US SMS shows in place of a brand.

## Alternatives considered

- **A column per field.** Three more columns, each threaded through the same fifteen files, and every future field
  the same again. The registry makes a field one entry.
- **Push and SMS as more channels of the same template**, drawing their text from the body. The long body never
  fits, and choosing which part to send is an editorial call the engine can't make without dropping content.
- **Separate push text per platform**, as Braze does. Twice the writing and the review for one difference (the
  subtitle); kept as a later option.
- **Default the platform** to iOS. A consumer that forgot the platform would send an iPhone subtitle to Android
  users, which Android then drops silently. Asking costs one field.

## Consequences

- Adding a channel is a compile error at every place that must handle it (`assertNever`), and its fields are one
  registry entry. A sixth channel joins one family or makes a third.
- A content type can't be converted from documents to messages; a new content type is made instead.
- The usage charts have five channel hues (`--series-1…5`, [0014](0014-chart-values-never-hover-only.md)).
- Review and Compare show and redline every channel's fields over the registry (`diffChannelFields`), so an email
  subject's change is redlined like the body's, and an alert's fields are its whole content there. A message has no
  blocks, so its comment threads anchor to its fields' ids (`commentAnchors`).
- Coral, the simulated consumer, delivers PDF, Web and Email only until it learns to show a phone.
