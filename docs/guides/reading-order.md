# Reading order

The order to read the code in, for a developer learning it or a group reading it together. It comes from the October
2026 quality review ([section 10](../quality-review-2026-10-12.md)) and goes from the rules every change follows, to
the business rules, to the seam between the app and its backend, to the data, the render engine, the API, the screens,
the editor and the tests. Each step names the files the reviewers found best at teaching that layer, small ones first.
Every layer's README comes before its code.

Read a file the way the code is written: its header comment is its contract, a `/** */` comment documents an export, and
a `//` comment records a decision at a line. [typescript-idioms.md](typescript-idioms.md) explains the patterns that
surprise a newcomer, and [nextjs-primer.md](nextjs-primer.md) covers the App Router. Then follow:

1. **The rules, and one mutation from end to end.**
   [AGENTS.md](../../AGENTS.md), [architecture.md](../architecture.md) (read "How requests flow"), then
   [actions/kit.ts](../../src/server/actions/kit.ts), the small module every server action runs on.

2. **The business rules.** [src/domain/README.md](../../src/domain/README.md) (the vocabulary and the lifecycle), then
   [lifecycle/sunset.ts](../../src/domain/lifecycle/sunset.ts) with its test, [permissions.ts](../../src/domain/permissions.ts),
   [refusals.ts](../../src/domain/refusals.ts), [rounds.ts](../../src/domain/rounds.ts) and
   [business-zone.ts](../../src/domain/business-zone.ts) (its header gives the Java equivalents). A rule takes facts
   and `now` and returns a decision; nothing here touches a database.

3. **The seam, and a command through it.** The app asks a service interface, not the database; this step follows one
   command, one read and autosave through it.
   - [services/README.md](../../src/server/services/README.md) explains the seam and its rules.
   - A command: [actions/review.ts](../../src/server/actions/review.ts) (`setSunset`, then `approveVersion`), its local
     implementation in [services/local/review.ts](../../src/server/services/local/review.ts) on
     [services/local/command.ts](../../src/server/services/local/command.ts), and
     [services/local/effects.ts](../../src/server/services/local/effects.ts), which writes a transition's audit rows,
     notifications and consumer notices in the same transaction.
   - A read: [queries/versions.ts](../../src/server/queries/versions.ts) over
     [lifecycle/version-actions.ts](../../src/domain/lifecycle/version-actions.ts), which decides what a viewer may do.
   - Autosave: [lifecycle/autosave.ts](../../src/domain/lifecycle/autosave.ts) and
     [services/local/drafts.ts](../../src/server/services/local/drafts.ts).

4. **How the seam is tested.** [contract/harness.ts](../../src/server/services/contract/harness.ts) says what an
   implementation provides, [contract/platform.ts](../../src/server/services/contract/platform.ts) is a suite of cases
   written against the interface, and [fake/platform.ts](../../src/server/services/fake/platform.ts) is the in-memory
   implementation that runs the same domain rules. [Decision 0068](../decisions/0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md)
   gives the reasoning.

5. **The data.** [db/schema/ucomp.ts](../../src/server/db/schema/ucomp.ts) end to end, the migrations
   [0003_consumer_notice_seq.sql](../../src/server/db/migrations/0003_consumer_notice_seq.sql) and
   [0008_review_rounds.sql](../../src/server/db/migrations/0008_review_rounds.sql), and
   [seed/templates/types.ts](../../src/server/seed/templates/types.ts), the spec the demo data is built from. Then
   [reference/data-model.md](../reference/data-model.md), the same schema as the Java API will build it.

6. **Rendering.** [render-spec.md](../render-spec.md): section 1 (Pipeline), sections 5 to 9 (Values to The RenderDoc)
   and section 13 (Golden files). Then [domain/render/resolve.ts](../../src/domain/render/resolve.ts),
   [server/render/engine.ts](../../src/server/render/engine.ts) and the
   [golden files' README](../../src/server/render/golden/README.md). The rule behind all of it: every channel prints
   exactly what the author typed.

7. **The consumer API.** [contracts/api-v1.ts](../../src/contracts/api-v1.ts) (the wire types, no imports),
   [golive/cursor.ts](../../src/domain/golive/cursor.ts), the route
   [api/v1/templates/route.ts](../../src/app/api/v1/templates/route.ts) and the reads it calls in
   [services/local/consumer-api.ts](../../src/server/services/local/consumer-api.ts). The OpenAPI brief in
   [reference/openapi-brief.md](../reference/openapi-brief.md) is what the Java team writes the spec from.

8. **The screens.** Start with [src/components/README.md](../../src/components/README.md), then:
   - [primitives/use-action-run.ts](../../src/components/primitives/use-action-run.ts) and
     [versions/action-dialog.tsx](../../src/components/versions/action-dialog.tsx): how a screen runs an action.
   - [settings/team/members-table.tsx](../../src/components/settings/team/members-table.tsx): server-decided actions
     rendered as controls.
   - [versions/versions-content.tsx](../../src/components/versions/versions-content.tsx): a streamed page.
   - Last, the hard state: [workspace/autosave/autosave-scheduler.ts](../../src/components/workspace/autosave/autosave-scheduler.ts)
     and [workspace/session/session-store.ts](../../src/components/workspace/session/session-store.ts).

9. **The editor.** [src/editor/README.md](../../src/editor/README.md) up to its "Document contract" section, then
   [model/normalize.ts](../../src/editor/model/normalize.ts), [model/document-check.ts](../../src/editor/model/document-check.ts),
   [model/contract.ts](../../src/editor/model/contract.ts), [extensions/required-sections.ts](../../src/editor/extensions/required-sections.ts)
   and [testing/editor.ts](../../src/editor/testing/editor.ts).

10. **The end-to-end tests.** [e2e/README.md](../../e2e/README.md), then
    [helpers/principles.ts](../../e2e/helpers/principles.ts) (its route and persona matrix is a map of the product),
    [storage.ts](../../e2e/storage.ts) and [playwright.config.ts](../../playwright.config.ts).

To make a change once you've read this far, follow [first-change.md](first-change.md).
