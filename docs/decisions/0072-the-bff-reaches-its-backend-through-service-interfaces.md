# 0072. The BFF reaches its backend through service interfaces, with a fail-closed request context

Status: Accepted
Date: 2026-10-13

## Context

The Java API replaces the SQLite backend, and this Next.js app stays the team's UI and BFF
([0067](0067-java-renders-every-channel.md), [0070](0070-rules-and-permission-checks-sit-behind-the-service-interfaces.md)).
Today the server actions and read models are the service layer
([B1](../handoff-review.md#b1--high-server-actions-are-the-service-layer)): each reads the persona cookie and the
demo clock itself, runs SQL and the domain rules, and words the screen. 0068 decided how the BFF is tested (a fake,
one contract suite); this records the seam those tests stand on. Lane F's design was reviewed adversarially before
anything built on it, and the owner settled its open questions on 2026-10-13.

## Decision

- **A request context, read once per request.** `src/server/context/request.ts`: the viewer, a correlation id, and a
  credential slot an HTTP implementation fills (the user's token for the Java API, or on-behalf-of: the sign-in work
  decides). It is the only reader of the persona cookie. It **fails closed**: with no viewer there is no context, so
  an action answers `signed_out`, a read route 401, and a page goes to the sign-in hook (`signInRequired()`, the one
  place real sign-in plugs in), never Not found. With `DEMO_MODE` off, a missing or unknown persona cookie is signed
  out; only the demo falls back to Maya.
- **The backend owns time.** The context carries no clock. A command is dated by the backend's own clock (the demo
  clock locally, Java's `Clock` later); a read that decides by time answers `asOf`, which the BFF words its dates
  from. The contract suite pins the backend's clock to an exact instant, so Java's test clock must be settable to an
  instant, not only offset ([0068](0068-the-bff-is-tested-against-a-fake-and-one-contract-suite.md) amended).
- **Service interfaces, one per area** (`src/server/services/*.ts`, 13 areas), each method `(ctx, input)` answering
  `ActionResult` (a command) or `ReadResult` (a read). Behind them the backend checks permissions, runs the domain and
  writes with a compare-and-set; a lost compare-and-set is `version_changed`. **Results are facts**, settings screens
  included: ids, ISO instants, days, codes, decided `PermissionResult`s, `Person` lists. No English but a refusal's
  reason, no app URLs. A method not yet settled is typed `Unsettled<owner>`, and lint keeps the BFF's view models
  out of the interface files. Documents a new template starts with (a starter, an import) are built and prepared
  by the BFF; the backend stores what it is handed.
- **`services()` is the only way in.** Lint forbids importing an implementation anywhere but `services/index.ts`,
  `/api/v1` (the backend's own API, which the Java API serves to consumers directly), the seed, the reset and tests,
  and confines Drizzle to the local implementation, `src/server/db` and the seed (a per-file ratchet while 2b moves
  the rest).
- **The local implementation** (`services/local/`) is today's Drizzle code on a command kit (`runCommand`): authorize,
  the clock once, one transaction. **Rules live in the domain**: a rule that both implementations would otherwise
  write (a double click, who a notification reaches) moves into `src/domain` first.
- **A slim fake** (`services/fake/`): the same domain rules over arrays, seeded like the database. Every command is
  implemented; a read only where a contract case must observe a command. BFF read-model tests hand facts straight to
  their pure shaping functions.
- **One contract suite** (`services/contract/`): cases written against the interfaces, run against the fake and the
  local implementation (and Java later). A case sets the clock, acts through the services, and compares reads before
  and after; it observes notices through `/api/v1`, and through a shrinking probe only what no read serves yet. Test
  hooks reach what a serializing database never shows: a competing write between a command's read and its write, and
  the scheduled jobs at a given instant. An agreement test compares the two implementations' reads of the whole seed.

## Alternatives considered

- **Services read the cookie and the clock themselves.** The seam would depend on Next.js request APIs, and an HTTP
  implementation couldn't tell Java who is calling.
- **The BFF supplies the instant** (the first design). A regulated backend won't take its audit time from a caller,
  and contract cases keyed to the caller's instant passed against a drifting clock while missing a wrong write.
- **Repository-style reads** (table access the BFF composes). The BFF would decide `can` itself, against 0070, and a
  screen would cost several round trips to Java.
- **Interfaces typed with today's worded view models.** They compile, so they would ship, and Java would port the
  English and the routes.
- **Mocks per call, or SQLite in memory as the fake.** Mocks pass while the backend drifts (0068); SQLite is the local
  implementation again, and gone after the port.
- **A full fake, reads included.** About 8–10k lines restating every query in array code; the slim fake implements
  reads only where a command must be observed.

## Consequences

- A screen's read is one service call answering facts; its read model words and lays them out and decides nothing.
- **The fake is a cost the Node team keeps**: a TypeScript twin of every command (and the few reads cases need) that
  must change with the backend. The contract suite is what keeps it honest; it is worth it only while it stays slim.
- `getViewer()` has one reader; the BFF reads no clock. `/api/v1`, the render pipeline's consumer side and the sweeps
  are the backend's own and are exempt (they have no viewer).
- Step 2b moves the remaining areas behind the seam (lane F's plan); until then the unmoved code still answers the old
  way, and the lint ratchet lists it.
