# 0070. Business rules and permission checks sit behind the service interfaces

Status: Accepted
Date: 2026-10-12

## Context

Today the server actions are the service layer
([B1](../handoff-review.md#b1--high-server-actions-are-the-service-layer)): each runs `can()` and the domain
transitions from `src/domain` inside the Next.js process, and the read models return decided `can` results
(`versionActions` in `src/server/queries/versions.ts`). Lane F puts service interfaces in front of that code. After the
port, Java is the backend. Without a rule, the rules could end up enforced in two places (TypeScript in the BFF, Java
behind it) or in neither.

How the BFF tells Java who is calling is a related question that the sign-in work hasn't answered yet.

## Decision

- **Rules and permission checks sit behind the service interfaces.** Today the local implementation calls the
  TypeScript domain; after the port, Java enforces them, having ported `src/domain` with the domain tests as its
  specification.
- **Read models return decided `can` results and refusal codes**; the BFF doesn't re-check a permission.
- **The BFF words refusal sentences by code** ([0025](0025-refusals-carry-stable-codes.md)), as it words
  notifications ([0055](0055-notifications-store-facts-and-are-worded-on-read.md)); Java returns codes and the facts a
  sentence needs.
- **Open, for the sign-in work:** the viewer's credential from the BFF to Java (the user's token forwarded for the
  Java API's scope, or an on-behalf-of exchange). Lane F's request context carries the viewer and a credential slot
  the HTTP implementation fills later.

## Alternatives considered

- **The BFF keeps evaluating the TypeScript domain over facts from Java.** Two implementations of every rule, and a
  Java API that would accept writes the rules refuse if anything called it directly.
- **Java decides, and the BFF re-checks for the UI.** The same two implementations, with the UI's copy as the one
  that drifts.

## Consequences

- **Node now (wave 2, lane F):** a premise of the seam's design. Services take a request context and return
  `ActionResult`, `ReadResult` and `can` results; components and routes call no rule themselves.
- **Java side:** `src/domain` is ported with its tests (pure and database-free) as the
  acceptance test; refusal codes are the contract.
- The UI's sentences stay in TypeScript, beside the screens that show them.
