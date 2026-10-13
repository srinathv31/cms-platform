# 0073. A new template's draft is built by the BFF for the content type the backend names, and the backend draws and retries the template id

Status: Accepted
Date: 2026-10-13

## Context

[0065](0065-documents-are-validated-against-a-generated-json-schema.md) has the BFF normalize and give block ids to
every document before it sends one, and [0072](0072-the-bff-reaches-its-backend-through-service-interfaces.md) keeps
the starter catalog and the importer (docx and PDF conversion, the worker, the zip limits) in the BFF, so the Java API
stores documents and never builds them. New template and Import did neither yet: both read the content type, drew a
template id and built the draft inside one server transaction. Splitting them raised four questions the seam had to
answer: which content type a draft is built for, where the BFF gets the date a starter's sample values are set from
when it reads no clock, who draws the template id, and where an import's original lives.

## Decision

- **The backend names the content type; the BFF builds for it.** `templates.newTemplateType(ctx, { teamId, family })`
  answers the content type a new template of the kind is made on (the domain's `newTemplateContentType`: the first of
  the family by name), its required sections and allowed channels, and `asOf`, the backend's instant. It refuses, in
  order, the permission to create on the team, a team that is gone, and a kind no content type makes
  (`no_content_type`, 409). The BFF resolves the URL's slug with `identity.space`, builds the starter or converts the
  file, fits it to those sections and channels (`conformToContentType`), prepares its documents (`prepareBody` and
  `prepareField`, starters included), and calls `templates.create` or `createImported` with a `DraftContent`.
- **`asOf` is the BFF's today.** A starter's sample dates are set relative to the instant `newTemplateType` answered,
  so the BFF reads no clock (`CLOCK_NOT_YET` no longer lists `import/create.ts`), and a demo clock advance still moves
  them.
- **The backend checks what it is handed, and stores it.** `create` refuses, in order, the permission, `team_gone`,
  `content_type_gone`, then channels the content type no longer allows (`newTemplateRefusal`: Platform settings may
  have changed since the BFF asked), and writes nothing. It creates the draft with `createTemplateFrom`, which both
  implementations call, dated by the backend's clock, with the author as its only writer.
- **The template id is the backend's.** It draws one from its id source, inserts with `ON CONFLICT DO NOTHING`, and
  writes the whole command again with a fresh id when the insert finds it taken: three attempts in all, and a third
  collision throws (`withNewTemplateId`, [0060](0060-template-ids-are-random-and-retried-on-a-collision.md)). The id
  source is an option of `localServices` and `fakeServices` and a member of the contract harness, so a case forces a
  collision. The BFF's block ids are seeded by a scope of its own (the template doesn't have its id yet).
- **An import's original is the backend's, with its report and its Compare HTML.** `createImported` stores the
  template, its draft, the original's bytes, the report (the facts in `src/domain/import-report.ts`, which the
  interfaces import) and a .docx's allowlisted Compare HTML, which the BFF's converter derived, in one write or none.
  Three reads answer the Original tab (`importOriginal`, `importOriginalView`, `importOriginalRef`), as facts: the
  uploader is a `Person`, the kind comes from the report. The BFF words the view (the report's lines, the file's URL,
  a text file's text). Locally the files are `services/local/uploads.ts` under `./data/uploads`.

## Alternatives considered

- **The backend builds the starter for a key** (the first shape of `templates.create`). Java would port the starter
  catalog and the document builders with the editor's schema; 0065 says it should not.
- **The BFF reads the content types through `platform.contentTypes`.** That read is the Platform settings screen's, for
  a platform admin; an author creating a template may not call it, and it would make the BFF choose the content type.
- **The BFF reads the clock or the demo clock for sample dates.** The BFF reads no clock (0072).
- **The BFF draws the template id**, or the backend reads for a free one first. Neither survives two concurrent
  creates; 0060 settles it as insert-and-retry.
- **Java converts the file again to show the Compare view.** Mammoth is Node; the backend keeps what the converter
  produced.

## Consequences

- **Node now:** `newTemplateType` is a small read beside the commands; the platform settings' own reads (plan P4b)
  don't have to serve the New template flow. A new content-type rule (which one a kind uses) is a domain function both
  implementations call.
- **Java side:** `newTemplateType` is one query and the domain's choice ported; `create` is one transaction with the
  retry around it; the original and the Compare HTML go to blob storage beside the report.
- The BFF's draft is prepared before the backend's checks run, so a content type edited in between is caught only as a
  channel the type no longer allows; its required sections are fitted as they stood, and existing templates are never
  reshaped.
