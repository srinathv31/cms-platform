# 0023. The email preview's fallback sender is Stencil's, and the other UCOMP names wait

Status: Accepted
Date: 2026-10-09

## Context

The product was called UCOMP before it was Stencil, and the name is left in a few places
([handoff review H5](../handoff-review.md#h5--low-rebrand-leftovers-two-of-them-customer-visible)). Two of them show
in output that looks like what a customer gets:

- The email preview's frame shows a sender made from the team's name ("Coral Offers"
  `<no-reply@coraloffers.example>`, `senderOf` in
  [preview-sender.ts](../../src/components/preview/preview-sender.ts)). A name with no ASCII letter or digit in it
  fell back to `no-reply@ucomp.example`.
- The PDF's font families are registered as "UCOMP Sans" and "UCOMP Serif"
  ([pdf-fonts.ts](../../src/server/render/channels/pdf-fonts.ts)).

The rest are internal: the `UC-` template id prefix, the database file, cookies, localStorage keys,
`UCOMP_API_ORIGIN`, `.ucomp-*` classes and the drag MIME type.

## Decision

The owner's call:

- The email sender's fallback is `no-reply@stencil.example`, now. `.example` is reserved (RFC 2606), so the
  address can't belong to anyone. The render engine's email channel prints no sender, so `/api/v1` output and the
  golden files don't change.
- The PDF font names stay until the enterprise font replaces the fonts
  ([the enterprise font](../handoff-review.md#the-enterprise-font)), which names the families again.
- Internal names stay. Renaming a cookie, a key or the database file needs a migration and a read-both fallback, and
  the id prefix needs its own decision; H5 stays Partly fixed until then.

## Alternatives considered

- **Rename everything now.** Touches persisted names (cookies, localStorage, the database file) and the id prefix
  for no customer benefit, and the PDF font families would be renamed twice.
- **A real-looking domain, such as `stencil.com`.** The preview would show an address someone may own.

## Consequences

- A team whose name has no ASCII letter or digit previews email from `no-reply@stencil.example`.
- "UCOMP" still shows in PDF font names until the font work, and in internal names until H5's rename.
