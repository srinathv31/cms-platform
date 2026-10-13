# 0067. Java renders every channel, held to the render spec and the golden files

Status: Accepted
Date: 2026-10-12

## Context

The render engine reads no database, clock or request (`runEngine` in `src/server/render/engine.ts`). It has a
normative spec ([render-spec.md](../render-spec.md)) and 67 golden cases that are "the acceptance test for a second
engine". Web, email, push and SMS are string work that ports line by line. The PDF is react-pdf plus a hand-written
line breaker and glyph check that lean on library internals (`src/server/render/channels/pdf-fonts.ts`,
`pdf-text.ts`); its page layout is declared non-normative. The fonts are Liberation Sans and Newsreader; the
enterprise font is pending ([R3](../handoff-review.md#r3--high-the-pdf-drops-characters-its-fonts-dont-have)). The CMS
preview runs the same engine as consumers ([0047](0047-stencils-preview-is-its-own-route-and-api-v1-serves-consumers-only.md)),
and push and SMS previews run in the browser with the engine's own `renderMessage`
([0036](0036-message-previews-resolve-in-the-browser.md)). Nothing in the spec mentions PDF/UA (tagged, accessible PDF)
or PDF/A (archival PDF).

## Decision

- **Java renders every channel**: the engine is ported, with PDFBox or OpenPDF for the PDF, its own line breaking
  under the spec's rules and its own glyph check.
- **The render spec and the golden files gate it**, run in the Java build.
- **The BFF's preview calls Java's render endpoint** with the viewer's identity, as 0047 foresaw; there is no other
  render service.
- **The Node engine leaves the server path after the port.** It survives only in the browser for push and SMS
  previews, accepted as approximations ([0046](0046-phone-previews-are-approximations.md)), unless those call Java
  too; that is decided with the port.
- **PDF/UA, PDF/A and the enterprise font's licence (embedding and subsetting) are settled before the PDF port
  starts**, and the font's coverage is written into render spec §10 (R3).

## Alternatives considered

- **The Node engine as an internal render service that Java calls.** One implementation of the spec, but one more
  deployable for a Java team to run, and react-pdf is unproven under concurrent load.
- **Java calls the BFF to render.** The backend would depend on the frontend, and batch renders (a statement run)
  would load the servers people edit on.
- **Java renders web, email, push and SMS, Node only the PDF.** Two engines for one spec, with the hardest channel on
  the side the Java team doesn't own.

## Consequences

- **Node now:** nothing new. Wave 1's golden cases (lane E) and wave 2's `breakLines` split (lane I) make the port
  easier.
- **Java side:** stages 6 to 9 in Java, a PDF layout of its own, and its own way to find table cells for the parity
  check (the backlog's "PDF cell detection for Java").
- Parity between the approver's preview and a consumer's output holds because both call Java. Parity between the
  browser's push and SMS previews and Java's output is a property of the golden files, while the browser keeps its
  own `renderMessage`.
- Document validation in Java follows from this ([0065](0065-documents-are-validated-against-a-generated-json-schema.md)).
