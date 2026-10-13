// The seam between the BFF (the server actions, the read models, the route handlers) and the backend that
// holds the data and the rules. `Services` is everything the BFF may ask the backend, one interface per area;
// src/server/services/README.md explains the seam, and each area's file says what its methods promise.
//
// Every method takes the request context first (`RequestContext`: the viewer, the instant, a correlation id
// and a credential slot) and answers in one of the shapes the BFF already speaks:
//
//   a command   `ActionResult<T>`: `{ ok: true, … }`, or `{ ok: false, code, reason }` with a stable code.
//   a read      `ReadResult<T>`: the data, or a refusal with the status a route answers (400/403/404/409).
//
// Rules and permission checks run behind these interfaces (decision 0070): an implementation decides, and the
// BFF never calls `can()` or a transition itself. What crosses the seam is plain data that survives JSON:
// instants are ISO strings, days are YYYY-MM-DD, people are ids (with a `Person` list where a screen names
// them), permissions come decided (`PermissionResult`). Nothing in a result is English except a refusal's
// `reason`, which the HTTP implementation will word from the code, as the BFF words everything else.
//
// A thrown error is a bug or an outage, never a refusal: the BFF lets it propagate to the screen's own
// failure sentence.

import type { AccessService } from "./access";
import type { AuditService } from "./audit";
import type { ClockService } from "./clock";
import type { CommentService } from "./comments";
import type { DemoService } from "./demo";
import type { DraftService } from "./drafts";
import type { IdentityService } from "./identity";
import type { NotificationService } from "./notifications";
import type { PlatformService } from "./platform";
import type { RenderService } from "./render";
import type { ReviewService } from "./review";
import type { TemplateService } from "./templates";
import type { UsageService } from "./usage";
import type { VersionService } from "./versions";

export type { RequestContext, Credential } from "@/server/context/request";
export type { ActionResult } from "@/domain/review-types";
export type { ReadResult, ReadRefusal } from "@/server/api/reads";

/** Everything the BFF asks the backend, by area. `services()` (./index.ts) returns the configured one. */
export interface Services {
  /** Who a credential names, the spaces they may enter, and the sidebar. */
  identity: IdentityService;
  /** The backend's clock: the demo clock locally, the Java API's (with its test offset) later. */
  clock: ClockService;
  /** The review lifecycle: submit, decide, sunset, revoke; the review queue and screen. */
  review: ReviewService;
  /** One template's versions: the Versions tab, Compare, "Revert to vN". */
  versions: VersionService;
  /** Templates as a whole: New template, Import, Edit, the Library, the palette, the workspace. */
  templates: TemplateService;
  /** Autosave. */
  drafts: DraftService;
  /** Review comments and their threads. */
  comments: CommentService;
  /** Team access: requests, members, recertification, inactivity. */
  access: AccessService;
  /** Platform settings: teams, content types, channels, chains, the business time zone. */
  platform: PlatformService;
  /** The bell. */
  notifications: NotificationService;
  /** The Audit page, its export, and a template's Activity tab. */
  audit: AuditService;
  /** The Usage dashboard and a template's Usage tab. */
  usage: UsageService;
  /** Stencil's own preview render (the consumer render is the backend's `/api/v1`). */
  render: RenderService;
  /** The demo tools (DEMO_MODE only): reset, the clock advance, the personas. */
  demo: DemoService;
}

/** A command that may find nothing to change (a double click): `changed` says whether it wrote. */
export interface Changed {
  changed: boolean;
}
