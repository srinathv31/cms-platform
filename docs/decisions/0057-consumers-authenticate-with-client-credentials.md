# 0057. Consumers authenticate with Entra ID client credentials

Status: Accepted
Date: 2026-10-12

## Context

A consumer names itself in `X-Consumer-Id: coral` and proves nothing
([S5](../handoff-review.md#s5--high-consumer-identity-is-a-self-asserted-header)): `requireConsumer` in
`src/server/queries/consumer-api.ts` and the render pipeline in `src/server/render/render-template.ts` look the id up
in `consumers`, whose `client_name` column (`coral-offers-svc` in `src/server/seed/platform.ts`) nothing reads.
Consumers exist only in the seed. Wave 1 already stopped two leaks: a caller that isn't a registered consumer writes no
`render_log` row, and a notices path naming any consumer but the caller answers 403. There is no rate limit.

Anyone who can reach the API can still render as any consumer and read any consumer's notices. The OpenAPI brief
needs a security scheme and its statuses, and the gateway team needs to know what to enforce.

## Decision

- **OAuth 2.0 client credentials with Entra ID.** Each consumer system has an app registration and calls with a token
  that names the system, not a person. The gateway validates the token, and Spring Security validates it again.
- **The token's client id (`azp`, or `appid` in v1 tokens) maps to `consumers.entra_app_id`**, unique, which replaces
  `client_name`. App roles scope what a consumer may do: `Stencil.Render`, `Stencil.Notices.Read`.
- **Statuses:** no token or a bad one is 401; a valid client that isn't a registered consumer, or that reads another
  consumer's notices, is 403. The `/consumers/{consumerId}/notices` path stays.
- **Rate limits per client id, at the gateway.**
- **No `render_log` row until the caller is authenticated and registered.** The gateway's logs keep the trail of
  failed attempts.

## Alternatives considered

- **mTLS** (a client certificate per consumer). Strong, but needs certificate lifecycle and gateway support.
- **Gateway subscription keys.** A shared secret per consumer: simpler and weaker.
- **Keep `X-Consumer-Id`, set by the gateway after it authenticates.** The trust then rests on the network path.

## Consequences

- **Node now:** nothing in wave 2; wave 1 did the two changes above. Coral calls with a dev token, or with the header
  on a demo-only path behind `DEMO_MODE` ([0051](0051-the-demo-tools-run-only-in-demo-mode.md)), decided when Coral
  is pointed at Java. Lane J's brief carries the security scheme, the app roles and the 401 and 403 rules.
- **Java side:** resource-server configuration, the claim-to-consumer lookup, and `consumers.entra_app_id`.
- **Not decided here:** a screen that registers a consumer and links it to an app registration. Consumers come from
  the seed until it exists; it is in the backlog for the handoff.
- The prototype log's call that an unregistered caller's render is logged as "the trail of who tried" no longer holds.
