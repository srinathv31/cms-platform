> **Archived.** Written while the prototype was being built; it doesn't describe the current code.
> See [the current docs](../README.md).

# UCOMP Content Platform — Discovery Brief

Oct 3, 2026 · @Sri

## Purpose and problem

UCOMP gives the business one controlled place to generate accurate customer content, replacing self-authored files that reach customers with no central controls.

Today, business and marketing channels author content themselves in Word or ad hoc templates. Marketing then publishes it to customers directly. Nothing checks it in between.

What goes wrong today:

- Disclosures go out with incorrect information.
- Teams interpret the same requirements differently.
- Invalid notifications reach customers.

Sri leads UCOMP (the MAL code) in the credit card technology space, covering both the CMS and the API enhancements.

## Scope and first client

UCOMP has two sides, a CMS web app and a notification delivery API, and its first deliverable is Coral disclosures, live in March 2027.

| Side | Stack | What it does | Status |
| --- | --- | --- | --- |
| Notification delivery API | Java Spring Boot | Takes a template or content and pushes it to UMP, which sends to digital channels such as the mobile app | Goes to production November 2026; its hard-coded template concept needs refactoring for the CMS |
| CMS web app | Next.js, Node 22 | Business users upload, create, and manage templates; connects to the API | New build |

**First client: Coral.** Coral is the bank's offers platform. The Coral business team logs into the CMS, creates a terms-and-conditions disclosure template, and links it to a Coral offer.

**Business-agnostic mandate.** The deliverable is Coral-specific, but the platform is not. It needs a generic core with business-specific modules, such as a first-party Coral adapter.

**Locale (Decided).** US only and English only, covering all states TD operates in.

**Infrastructure.** Most of it is already in place; Blob storage is the only new resource.

- **In place:** the November prod footprint includes the App Services (API and Next.js CMS), Azure SQL, and existing service-to-service auth (PingFed client IDs).
- **Fluxnova** (the BPMN engine forked from Camunda 7): expected to be present. It's a framework added to the Spring Boot app, so it's a quick hit.
- **Blob storage:** already within the Azure subscription. Infra and architecture update their design docs for audit, then DevOps deploys it. The infra contact is already engaged. We proceed assuming plain Blob; the architect may require ADLS.
- **Entra ID:** the onboarding request was submitted in late September 2026. It is expected well ahead of January.

## Guiding principles

UCOMP stores templates, never customer data, and is the only place content is authored, approved, and rendered.

**Decided**

1. **Templates only.** No PII or PCI is ever stored. One disclosure is one template file, even if 10M customers receive it.
2. **UCOMP renders.** Consumers never fill templates themselves.
3. **Centralized authoring.** Consumers can't create or publish templates; that would defeat centralization.
4. **Review inside the tool.** No email or out-of-band review, because it can't be tracked.
5. **Audit trail first.** Versioning is automatic and first-class.
6. **One click is a design philosophy.** Every feature should cut steps for non-technical business users. It is not one literal button.
7. **No in-app AI in release 1.** Bank regulation rules it out; AI is future state (see AI roadmap).

**Proposed**

8. **Numbers are never retyped.** If a value exists in a system of record, nobody types it into a template.

## Architecture overview

The Spring Boot UCOMP API is the hub: the CMS, consumers, and UMP delivery all go through it, and only it touches storage and rules.

&#91;embedded content: UCOMP architecture · 10 components, calls and auth (Entra for users, PingFed for consumers)\]

Read top to bottom: users work in the CMS, the CMS and consumers call the API, and the API alone reads storage and Fluxnova. Users sign in through Entra ID; consumers authenticate through PingFed. Blob is the only new infra resource.

**Responsibilities**

- **Next.js CMS** (App Service, Node 22): authoring, import, review, and team admin. Preview goes through the API (proposed).
- **UCOMP API** (Spring Boot): search, get, preview, render; delivery to UMP; lifecycle events. Production infrastructure already exists.
- **Azure SQL:** template metadata, version state, audit history, and the render log (proposed).
- **Blob storage:** one file per template; original uploads kept as provenance (proposed). The only new infra resource. We proceed with plain Blob; the architect may require ADLS.
- **Fluxnova:** rules engine only, never the state machine or renderer. Approval chain as DMN and BPMN is proposed.
- **Entra ID:** SSO for CMS users. Consumers don't authenticate through Entra.
- **PingFed:** consumers authenticate to the API with their existing client IDs (OAuth with scopes).
- **Consumers (Coral first):** own the offer-to-template link and call render. An upstream system stores each output and presents it to customers.

**CMS → API auth (Decided).** The CMS uses Better Auth for the user's session and passes the access token to the API. Consumers keep their existing PingFed client IDs. Auth details are an implementation task, kept out of this brief.

## Content model and channels

One template renders to several output types under rules, and every template is stored in one canonical block format.

### Decided

- **Channels:** email, PDF, HTML, mobile app banners, and SMS. Rendering rules apply, e.g., no disclosures via SMS.
- **Release 1 channels:** PDF, HTML, and likely email; email is included to play safe. SMS and banner are deferred.
- **Disclosures** go out by email, web, or mobile, so as PDF or HTML.
- **Authoring:** upload Word, PDF, or text; create from scratch in the browser; or upload, then edit in the browser.
- **Imports land as drafts:** every import (PDF, Word, or text) lands as a Draft, and the user takes it from there. There's no user-facing "near-final vs draft" distinction.
- **Layouts:** pixel-exact layouts are out of scope for now and possible in future.
- **Editor:** TipTap, Notion-like, with drag-and-drop blocks. Dynamic values are very obvious and draggable. An editor deep dive comes later.
- **Placeholders:** templates hold placeholders for dynamic values, e.g., first name, last name, dynamic APR, state.
- **One click:** a design philosophy, not one literal button. Every feature should cut steps for business users.

### Proposed

**Three kinds of content in a disclosure.** If a number exists in a system of record, nobody retypes it.

| Kind | Example | Source |
| --- | --- | --- |
| Legal text | Terms wording | Authored, approved, frozen per version |
| Offer terms | "Spend $1,000, get $200" | Consumer's system of record, or hardcoded in the text (open) |
| Customer values | First name, APR, state | Supplied at render time |

**Offer terms are open, to confirm with the business.** The business is leaning toward hardcoding offer terms in the text, with customer info dynamic. Proposed: each variable gets a scope attribute (customer or offer), so either answer fits. If offer terms are hardcoded, each offer needs its own template, and a "clone from base template" feature becomes essential.

**Canonical format.** TipTap/ProseMirror JSON is the only source format.

- Uploads are imports converted into blocks. The original file stays in Blob as provenance and is never rendered from.
- Variables are TipTap inline nodes tied to the template's variable list, not literal `{{ }}` text. Import converts `{{ }}` into nodes.
- Pixel-exact layouts are out of scope for now (decided). A fixed-layout, PDF-only template kind could come later if needed.

**Import fidelity by format.** Users see every import as a Draft. Fidelity differs by format, but that's an internal implementation concern.

| Format | What survives conversion |
| --- | --- |
| Word | Best fidelity: headings, lists, tables, bold |
| Text | Everything, with no formatting |
| PDF | Mostly text; PDFs store positions, not structure |

Control (proposed): each import opens side by side with the original, and the author confirms they match before submitting.

**Template bundle.** A bundle holds a shared variable schema, a main body (PDF/HTML/email), and channel variants where needed. Variants include SMS text, email subject and preheader, and banner headline and call to action. One version number covers the bundle, and approvers review every channel's rendered output.

**Content types as blueprints.** This is one way to express the one-click philosophy. A new disclosure starts with required sections placed: terms body and legal footer. Required variables, allowed channels, and the approval chain are preset. Publishing is blocked if a required section is removed.

**Starter-template gallery (Sri's idea).** Users begin from example templates, like Word's templates; most will pick Blank. Proposed: Blank still includes the content type's required sections.

**Channel rules by content type (example only).**

| Content type | Allowed channels |
| --- | --- |
| Disclosure | PDF, HTML, email |
| Notification | Email, SMS, push |
| Banner | In-app, email |

Rules are enforced at publish time and at render time; a disallowed render request returns HTTP 422.

**Email output (proposed).** Email output is structured: subject, preheader, HTML body, and text body. It needs a separate email-safe HTML renderer (inline styles, table layout), tested against Outlook early.

## Rendering

The Spring API renders every output at request time and persists nothing it renders; campaign-scale PDF volume is the main sizing question.

### Decided

- A consumer POSTs a render request with the template ID and all data.
- The API generates the file at runtime. Documents return as binary by default, with the right content type; base64 only for consumers that can't accept binary. Output is never persisted or cached.
- The Spring API does all rendering. Fluxnova is a rules engine, not the renderer or state machine.
- Volume: a template linked to an offer targeting 1M customers means about 1M render calls.
- The upstream system stores each output and presents it to the customer. UCOMP doesn't serve customer views on demand.
- Preview by template ID uses dummy data.

### Proposed

- **Pipeline:** walk the block JSON in Java to produce HTML, then PDF via OpenHTMLtoPDF or similar. Email uses a separate email-safe renderer (see Content model). SMS is plain text.
- **Preview parity:** the CMS preview calls the API's render, so preview always matches production.
- **Render log** per call: template, version, consumer, timestamp, and correlation ID, with no PII.
- **PII in transit:** keep request and response bodies out of logs and APM.
- **Outputs with parts return JSON:** email, for example, comes back as subject, preheader, and bodies.
- **Caching:** published versions are immutable, so compiled templates can be cached per version indefinitely.

**Volume estimate (assumption, not measured).** At about 100 ms of CPU per PDF, 1M PDFs is about 28 CPU-hours, or roughly an hour across 32 cores. HTML and SMS renders are negligible. This suggests a batch or async render endpoint for campaign jobs, plus an early spike to measure real PDF render time. That benchmark is still open.

## Versioning and lifecycle

Every submitted change becomes a new numbered version with an automatic audit trail, and consumers never see drafts.

&#91;embedded content: Proposed version states · 6 states, 8 transitions\]

Read left to right: a draft gets its number at submit, and only an approved version reaches consumers.

**Decided**

- Versioning is automatic and first-class. The audit trail is the top concern.
- A version number is assigned when a draft is submitted, not on every draft save.
- Any change after submit creates a new version.
- Old versions can be flagged usable or unusable.
- Consumers only ever see Active (or later-state) templates, never drafts.

**Superseding.** Consumers relink explicitly, so nothing changes silently and production never breaks.

- **Pin** (default): consumers keep rendering their linked version until they relink. An event and the usage view tell them a newer version exists.
- **Sunset:** the approver sets an end date on the old version. Consumers get notice to upgrade on their own time; after the date, the version stops rendering.
- **Revoke:** emergencies only. Rendering stops immediately.

Open: the sunset notice period and how consumers are notified, once the delivery path is mapped.

**Proposed**

- The six states shown above. Superseded is Sri's "usable old version"; Revoked is "unusable."
- Revoking requires a reason and its own maker-checker.
- Azure SQL temporal tables keep row history automatically. Ledger tables add tamper evidence.
- A Blob immutability policy could protect published versions; ask records management.

**Open**

- **Retention.** Planning assumption: 7 years, to confirm.
  - Proposed: measure retention from a version's last use, not its creation.
  - Proposed: keep a separate review cycle. Active templates get a review-by date, and the owner re-attests or the template is flagged.

## Controls and approvals

All review happens inside UCOMP under maker-checker, and the approval chain should be configuration, not code.

### Decided

- All review and approval happens in UCOMP. No email or out-of-band review.
- Maker-checker is required: the author can't approve their own work.
- In release 1, a single approval step by an admin user moves a submitted draft to Active, with maker-checker.
- Multi-team approvals (legal, marketing) come after release 1. Business, and possibly audit or security, may follow.
- Fluxnova is used as a rules engine, not as the state machine.

### Proposed

**Approval chain as config.**

| Piece | Job |
| --- | --- |
| Fluxnova DMN decision table | Maps content type to required approval stages |
| Fluxnova BPMN process | Runs those stages |
| Azure SQL | Holds version state |

In release 1 every DMN row says Admin. Adding legal later is a new row, not a deployment.

**Review UI.** A block-level redline diff between versions, plus comments anchored to blocks.

**Audit and security as roles.** These fit better as roles than as approvers. An Auditor gets read-only access across all teams with full history.

**Consumer-side approval (optional).** Coral's campaign controls gate could show the disclosure rendered with real offer terms and dummy customer data. Approving the campaign then approves the disclosure as customers will see it.

## State- and regulation-specific language (parked)

State-specific language is not a confirmed requirement: it was raised as a brainstorming example. It's parked with the other unknowns until discovery confirms whether Coral's disclosures need it.

If it is needed, the clause library is likely owned by the business team, with legal consulted.

**Ideas captured for later:**

- A state notice block
- State-tagged blocks
- A "View as \[state\]" preview
- A coverage check

## Teams and access control

Users see only their own team's content, and release 1 manages team membership and roles inside the app (option B, current direction).

### Decided

- Multiple business teams or lines use the platform. Users see only their own team's content.
- Access is read or write per team, with a Linear-style team switcher.
- Role-based access control is first-class. E.g., a Coral offers user shouldn't see mortgage-rate or statement content.
- Business users are not tech-savvy.
- **In-app access control for release 1 (current direction).** Access-control discovery is a to-do: Sri will take the needs to the Entra team.
- Coral's team admins are the same people who use the Coral app (names TBD).

**Options compared.** Option B trades IAM's built-in controls for speed and flexibility, so it must build its own recertification.

| Topic | A: Entra groups per team role (e.g., Coral Admin/Write/Read) | B: Entra login + one coarse group, teams and roles in-app (current direction) |
| --- | --- | --- |
| New team setup | New groups per team via Entra tickets; lead time and provisioning-error risk (Sri's concern) | Team admins manage it in-app, immediately |
| Joiners | IAM access request | In-app request, team admin approves |
| Movers | Handled if IAM ties groups to role changes | Gap: old access remains until recert or revoke |
| Leavers | Covered: a disabled Entra account can't sign in | Covered: a disabled Entra account can't sign in |
| Recertification evidence | IAM's existing process | Must be built |
| Audit of grants | IAM logs | App logs |
| Token size | Group overage if raw groups are in the token; use app roles | Not an issue |
| Flexibility (new roles, cross-team reviewers) | Rigid | Flexible |

### Proposed model

Entra handles login plus two coarse groups: `UCOMP-Users` and `UCOMP-PlatformAdmins`. Team membership and roles live in the app: a user requests access, and a team admin approves.

| Role | Scope | Can |
| --- | --- | --- |
| Viewer | Per team | Read the team's templates |
| Author | Per team | Create and edit drafts |
| Approver | Per team | Approve others' work (maker-checker) |
| Team Admin | Per team | Approve access requests, recertify members |
| Legal/Compliance reviewer | Cross-team | Review content |
| Auditor | Cross-team | Read-only, all teams, full history |
| Platform Admin | Cross-team | Manage teams, content types, channel rules; can't edit content |

Consumer PingFed client IDs are scoped to their team's templates plus shared ones.

**Gaps to close with B.** Entra covers leavers, but not people who move teams. Option B needs:

- Quarterly recertification by team admins, or access lapses.
- Inactivity expiry (e.g., 90 days).
- Every grant and revoke audited.
- No self-approval of access requests.
- Bootstrapping each team's first admin: a platform admin assigns them.
- Mover detection.

**Questions for the Entra team.**

1. Can our app registration define app roles assigned to groups?
2. What's the lead time to create and assign a new group?
3. Can team owners self-manage membership, and does recertification cover app-level groups?
4. From an audit standpoint, is one coarse group (`UCOMP-Users`) acceptable as the gate, with app-managed roles inside it?
5. Does the CMS onboarding request include exposing an API scope for the UCOMP API?

## Consumer integration and API surface

Consumers search, preview, and render templates through the API, and they own the link between their records and a template.

### Decided

- **Auth:** consumers authenticate with their existing PingFed client IDs (OAuth with scopes).
- **Linking lives in the consumer.** The offer-to-template link is stored in Coral, not UCOMP. UCOMP only holds the templates it owns.
- **No consumer publishing.** A request-for-draft POST endpoint is acceptable later; a UCOMP user picks it up and moves it through the lifecycle.
- **API needs:** search by template name and by ID, with pagination, plus preview by ID using dummy data.
- **Visibility:** consumers only see Active (or later-state) templates, never drafts.
- **Delivery to customers:** rendered content reaches customers through UMP. Mapping the exact path is Sri's discovery takeaway.

### Proposed endpoints

| Endpoint | Purpose | Release |
| --- | --- | --- |
| Search | By template name or ID, paginated | 1 |
| Get by ID | Fetch one template by its ID | 1 |
| Preview | Render by ID with dummy data | 1 |
| Render | Render by ID with the consumer's data; binary for documents, JSON for email (proposed) | 1 |
| Draft request | Consumer asks for a new template | Later |
| Batch render | Async render for campaign-scale jobs | Later |
| Lifecycle events | Emitted when a version is activated, superseded, or revoked | 1 |

**Separate surfaces (proposed).** Authoring endpoints serve only the CMS. Consumer endpoints (search, get, preview, render, and later draft requests) serve only consumers.

**Usage visibility (proposed).** Because the link lives in the consumer, UCOMP can't directly answer "who uses v3?" A usage view built from the render log closes the gap. Consumers also subscribe to lifecycle events.

### Proposed draft-request flow (later)

1. The consumer POSTs a request: content type, an external reference UCOMP treats as opaque, needed variables, and notes.
2. It lands in the owning team's queue.
3. An author builds it, and it goes through maker-checker.
4. Once Active, UCOMP emits an event with the template ID, version, and the original reference.
5. The consumer links it.

**Dependency.** Coral's UI needs a template picker that calls UCOMP's search API. This sits in Coral's backlog.

## Proposed release 1 scope

Release 1 (proposed) ships Coral disclosures end to end with full lifecycle and access controls, and defers SMS, banner, multi-team approvals, and all in-app AI.

| In release 1 (March) | Later | Candidate / stretch |
| --- | --- | --- |
| Disclosure content type rendering to PDF, HTML, and email (email included to play safe) | SMS and banner channels | Starter-template gallery |
| TipTap editor with variable nodes | Multi-team approvals (legal, marketing) | Copilot prompt library, if risk confirms it isn't in-app AI |
| Import of Word, PDF, and text, all landing as drafts | Draft-request endpoint |  |
| Server-rendered preview with sample data | Batch render |  |
| Full version lifecycle | All in-app AI (see AI roadmap) |  |
| Single-step approval with maker-checker, chain stored as config | State-specific language (parked) |  |
| Teams and in-app access control with recertification |  |  |
| API: search, get, preview, render |  |  |
| Render log and lifecycle events |  |  |

**Dependency.** Coral's UI needs a template picker calling UCOMP's search API (Coral's backlog).

## AI roadmap (future state)

Release 1 has no in-app AI because of bank regulation (Decided). AI is future state, separate from the March release.

**Release 1-compatible workaround (Sri's idea, candidate).** A copy-paste prompt library: the app generates prompts that users paste into the Copilot on their laptop (Microsoft Copilot or GitHub Copilot).

- Proposed: each prompt includes the template's variable list, so the output uses UCOMP's variable syntax.
- Proposed: the output is pasted back as a draft and goes through normal maker-checker.
- Proposed: templates hold no PII, so this is low risk.
- Open: confirm with risk and compliance that this counts as "no in-app AI".

**Future (Sri's estimate: end of 2027).**

- AI control-gap checks in the editor (variable names, dollar amounts, rates)
- AI-assisted import that suggests variable candidates
- "Describe the template you need" generation

**Guardrails (proposed).** Suggestions only, and a human confirms. Normal maker-checker applies, and calls are routed through the USAMT AI gateway.

## Timeline and risks

Infrastructure is largely in place: the November footprint covers the App Services, Azure SQL, and PingFed service auth. The Entra onboarding was submitted in late September. Fluxnova is a quick add, and Blob is the only new resource. Go-dark is mid-January 2027 and go-live is March 2027.

&#91;embedded content: UCOMP milestones, Sep 2026 to Mar 2027\]

The only infra work left before go-dark is Blob's design-doc update and deploy; the Entra onboarding is already submitted.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Blob deploy or design-doc update slips | Low | Infra contact already engaged |
| Offer terms unconfirmed (business leaning toward hardcoding) | Decides placeholders vs one template per offer | Confirm with the business; variable scope fits either answer (proposed) |
| State-specific language need unknown (parked) | Not in release 1 scope; parked with the other unknowns | Discovery confirms whether Coral's disclosures need it |
| Refactor of the hard-coded API template concept | Planning assumption: refactoring the existing API costs about 80% of a net-new build (deliberately conservative) | Review the current API template design in internal discovery |
| PDF render throughput | Estimate: about 28 CPU-hours per 1M PDFs | Early spike to measure real render time; batch or async render endpoint |
| Adoption by non-technical business users | Centralization only works if business teams author in UCOMP | Content-type blueprints, Word import, and the one-click philosophy (proposed) |
| CMS→API auth details | Low | Better Auth session in the CMS, access token passed to the API (decided) |
| Email in release 1 renders inconsistently across clients | Medium | Separate email-safe renderer; test Outlook early (proposed) |

## Decision log

Twenty-seven items are decided by Sri, some as planning assumptions to confirm; nineteen are Claude's proposals awaiting confirmation in discovery. Change a status as items are confirmed.

| Decision | Status | Note |
| --- | --- | --- |
| Templates only; no PII or PCI ever stored | Decided | Rendered output never persisted or cached |
| UCOMP renders; consumers never fill templates | Decided | Output reaches customers through UMP; Sri to map the exact path |
| API: search by name and ID with pagination; preview by ID with dummy data | Decided |  |
| One template renders to multiple channels, under rendering rules | Decided | Disclosures go out as PDF, HTML, or email |
| Author by upload (Word, PDF, text), browser editor, or both; TipTap editor | Decided | Editor deep dive later |
| Version number assigned at submit; any later change is a new version | Decided | Old versions flagged usable or unusable; audit trail is top concern |
| Offer-to-template link lives in the consumer | Decided | UCOMP holds only its templates |
| Consumers can't create or publish templates | Decided | A draft-request POST is acceptable later |
| All review in UCOMP, with maker-checker | Decided | No email or out-of-band review |
| Release 1 approvals: a single step with maker-checker | Decided | Legal and marketing after release 1 |
| US only, English only | Decided | All states TD operates in |
| Upstream system stores outputs; UCOMP serves no customer views | Decided | About 1M render calls for a 1M-customer offer |
| Multi-team, per-team read/write, first-class RBAC | Decided | Access managed in-app for release 1 |
| Fluxnova is a rules engine; the Spring API renders | Decided | Fluxnova is not the state machine |
| Email in release 1, to play safe | Decided | SMS and banner deferred |
| No in-app AI in release 1 | Decided | Bank regulation; AI is future state |
| All imports (PDF, Word, text) land as drafts | Decided | No user-facing near-final vs draft distinction |
| Pixel-exact layouts out of scope for now | Decided | Possible in future |
| In-app access control for release 1 | Decided | To confirm with the Entra team |
| Azure SQL; proceed with plain Blob | Decided | The architect may require ADLS |
| Consumers authenticate with existing PingFed client IDs | Decided | OAuth with scopes; not Entra |
| Binary responses by default | Decided | Base64 only for consumers that can't accept binary |
| Planning assumption: refactor ≈ 80% of a net-new build | Decided | Deliberately conservative |
| State-specific language parked as an unknown | Decided | Raised as a brainstorming example, not a confirmed requirement |
| Retention: assume 7 years | Decided | Planning assumption, to confirm |
| CMS uses Better Auth and passes the access token to the API | Decided | Auth details are implementation, outside this brief |
| Pin / Sunset / Revoke on supersede | Decided | Pin is the default; sunset gives notice; revoke for emergencies |
| Three content kinds; variables scoped customer or offer | Proposed | Fits either answer on offer terms; business leaning toward hardcoding |
| TipTap JSON is the only source format; uploads are imports | Proposed | Original file kept in Blob as provenance |
| Template bundle with one version number across channels | Proposed | Approvers review every channel's output |
| Content types as blueprints with required sections | Proposed | One way to express the one-click philosophy |
| Channel rules enforced at publish and render | Proposed | Disallowed render returns HTTP 422 |
| Render HTML in Java, then PDF via OpenHTMLtoPDF or similar | Proposed | CMS preview calls the API's render |
| Render log without PII; bodies kept out of logs and APM | Proposed | Also feeds the usage view |
| Six version states, Draft through Revoked | Proposed | Revoke needs a reason and its own maker-checker |
| Automatic audit via Azure SQL temporal (and ledger) tables | Proposed | Retention: assume 7 years, to confirm |
| Approval chain as Fluxnova DMN + BPMN config | Proposed | Adding legal is a new row, not a deployment |
| State notice block with coverage check (parked) | Proposed | Idea only; state-specific language is parked |
| Two coarse Entra groups; teams and roles in-app | Proposed | Recertification, inactivity expiry, audited grants |
| Batch render endpoint and early PDF benchmark spike | Proposed | Based on an estimate, not a measurement |
| Separate CMS and consumer API surfaces | Proposed | Authoring endpoints for the CMS only |
| Retention measured from last use, plus a review cycle | Proposed | Active templates get a review-by date |
| JSON for multi-part outputs, such as email | Proposed | Subject, preheader, and bodies |
| Email-safe renderer | Proposed | Inline styles, table layout; test Outlook early |
| Copilot prompt library | Proposed | Sri's idea; confirm with risk it isn't in-app AI |
| Starter-template gallery | Proposed | Sri's idea; Blank keeps required sections |

## Open questions

The biggest remaining unknowns are how rendered documents reach customers, offer terms, and superseding behavior.

### Infrastructure

- [x] Does the November prod footprint include an App Service for Next.js and the Blob storage? — It covers everything except Blob
- [x] Is Fluxnova actually deployed in UCOMP? — Expected; a quick add
- [x] Azure SQL, or which SQL Server version? This affects temporal and ledger tables. — Azure SQL
- [x] Plain Blob or ADLS? — Proceeding with plain Blob; the architect may say ADLS
- [x] Is there an Entra app registration for the CMS? — Submitted late September
- [ ] Settle the CMS→API auth pattern
- [ ] Confirm the Entra request exposes an API scope for the UCOMP API
- [ ] Blob design-doc update and DevOps deploy

### Business

- [ ] Which content types and channels come after disclosures? — Sri's takeaway
- [ ] Who are the Coral team admins in release 1? — The same people who use the Coral app; names TBD
- [ ] How does rendered content reach customers, and through which upstream systems? — Through UMP; Sri to map the path
- [ ] Do Coral's first disclosures need state-specific language? — Assumed but unconfirmed; parked
- [ ] Who owns the state clause library: legal, compliance, or each business team? — If needed, the business team owns it, with legal consulted

### Legal and compliance

- [ ] Are offer terms placeholders, or hardcoded in the text? — The business is leaning toward hardcoding; confirm
- [x] What is the approval chain per content type? — Release 1 is a single approval; legal and marketing after release 1
- [ ] What is the retention requirement for published versions? — Assume 7 years; confirm
- [x] Are pixel-exact layouts required? — Not in scope for now
- [ ] When a version is superseded, must consumers re-link and re-approve, or may they float to the latest? — Deep dive; Sri leans toward explicit relink; depends on the delivery path
- [ ] Confirm a Copilot prompt library counts as "no in-app AI"

### Internal discovery

- [x] Current API template design and refactor scope — Planning assumption ≈ 80% of net-new
- [ ] PDF render benchmark — Still needed; open to the best transport
- [x] Which upload formats to support — PDF, Word, and text
- [ ] Access-control discovery with the Entra team (see Teams)
