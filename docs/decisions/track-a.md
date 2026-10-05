# Track A decisions (Phase 5, going live)

Autonomous calls made by the lead. Each can be overruled at review.

## Contracts (accepted from the Phase 5 brief)
- **Simulator calls UCOMP server-side** from its own origin (via `headers()`), so the browser never logs the intended 4xx/410 failures. Keeps "zero console errors" true during failure scenarios.
- **Consumer GET endpoints require `X-Consumer-Id`.** Same header as render; unknown consumer → `consumer_not_found`.
- **"Renders this month" is a rolling 30 days vs. the 30 before**, labelled "Renders · 30 days". Calendar months make the demo clock jumps look wrong.
- **A link can be saved with unmapped required variables.** Send is then disabled and names the missing ones (explain only when blocked).
- **A send renders every linked channel** for each chosen customer.
- **The integration panel loads via a server action when opened**, so neither header file changes.
- **The Demo pill is mounted in the simulator layout** too, so scenario 5 can advance the clock without leaving Coral.
- **The simulator palette lives in `src/simulator/theme.css`**, the one place outside `tokens.css` with raw colours. It follows the recorded "deliberately foreign" decision (Q7).
- **The contract is split** into `src/contracts/api-v1.ts` (wire shapes, import-free, lint-enforced), `src/domain/golive-types.ts` (UCOMP side), `src/simulator/types.ts` (Coral side), because the simulator boundary forbids importing `@/domain`.

## Simulator look: **A (Ops console)** with two borrowings from B
Mock: `/design/simulator?v=a|b|c` (kept as reference). Media: `docs/decisions/media/track-a/` (`simulator-tour.webm`).
- **Picked:** A, a navy sidebar (Offers, Customers, Deliveries, Notices with a badge); one offer = one page with Template | Values | Send tabs; dense tables with mono keys; the customer view in a right-hand drawer. Helvetica Neue, 5px corners, cool grey, signal-orange accent. Stills: `simulator-a-offers.png`, `simulator-a-link.png`, `simulator-a-map.png`, `simulator-a-send.png`, `simulator-a-customer-phone.png`, `simulator-a-notices.png`, `simulator-a-relink.png`, `simulator-a-sunset.png`.
  - Why: the plan asks for "a results grid" with exact render errors, and A's table is exactly that; it reads most convincingly as another company's back-office tool (the point of the Q7 "deliberately foreign" decision) and shows the contract and mapping densely for the engineer audience.
- **Borrowed from B:** the results headline ("4 delivered, 1 failed") above A's grid, and the relink as consequence-first steps (What changed → Map new value → Confirm) inside A's page, so consequences come before commitment.
- **Rejected B (Top-nav wizard)** (`simulator-b-*.png`): the most story-like, but it reads as a marketing campaign tool rather than a bank's ops system, loses the contract/mapping tables, and has lots of empty space.
- **Rejected C (Split-pane workbench)** (`simulator-c-*.png`): dark graphite makes the UCOMP boundary jarring, and three panes are tight at 1280. Its always-visible customer preview is a later idea.
- Coral's own accent colour on its primary button is intentional: the one-black-primary rule is UCOMP's, not Coral's.

## Usage dashboard: **A (Insights)** + B's consumers table
Mock: `/design/usage-dashboard?v=a|b|c&scope=team|template` (kept as reference). Media: `usage-tour.webm`.
- **Picked:** A, following reference-images/Unknown.png: serif "Usage" title, Overview | Consumers tabs, three stat cards (Renders · 30 days with trend + channel mix; a gauge for renders on active versions; active templates with sunset note), Top templates bars beside a Daily renders heatmap, Renders over time (13 weeks, stacked by channel) and failure rate. Stills: `usage-a.png`, `usage-a-full.png`, `usage-a-consumers.png`, `usage-a-tooltip.png`.
- **Borrowed from B:** the consumers table (version StatusBadge, sunset note, 30-day sparkline, All / On superseded / Failing filter) as A's Consumers tab: it answers "who renders what, on which version", which feeds the approve/sunset/revoke consequence text.
- **Rejected B as the page** (`usage-b*.png`): least like Unknown.png, with charts as an afterthought. **Rejected C** (`usage-c*.png`): two tab-like controls on one page, no heatmap.
- **Per-template Usage tab:** as mocked (`usage-template.png`): renders by version, "N% still on vX", "Who renders it".

## Simulator core (S3)
- **A send fails as an action only when UCOMP can't be reached at all**; render failures are stored as result rows with the API's exact `{status, code, message}`.
- **No persona or permission check in the simulator**: Coral acts as itself through `X-Consumer-Id: coral`.
- **Delivery ids keep send order** (`dlv_<batch>_<NNN>`), so a batch reads back in customer then channel order; each delivery is stamped with real time.
- **At most 3 renders in flight** per send.

## Usage aggregation (S2)
- **Usage counts** only non-preview renders with a consumer, at or before `now()` (demo clock). Windows: current = [now − 30d, now], previous = [now − 60d, now − 30d). Days are UTC days of the demo clock.
- **One denominator: a render is an attempt (succeeded + failed).** "Renders" everywhere (headline, Top templates, heatmap, weekly bars, a consumer's row, the gauge) counts every attempt; "failed" is the subset that errored; "succeeded" is the rest as a share of attempts, and shows "—" when there were none. A template whose only render failed reads "1 render, 0% succeeded, 1 failed". (QA fix batch; before, "renders" meant successes only, so the cards didn't reconcile.)
- **"Consumers"** counts any consumer with a render in the window, failed or not.
- **A consumer row's note adds only the extra fact** ("sunset in 21 days", "3 failed renders", "renders fail"); the Version badge already says Superseded, Revoked and the sunset date.
- **A future sunset is a warning only within `NEARING_SUNSET_DAYS`**; further out it shows the same text, neutral.
- **The "N failed renders" tag applies to Active rows too**, otherwise the "Failing" filter would never catch Cash Back v2; it's dropped when the row already says "renders fail".
- **Rows sort danger first**, then warning, then other tags, then by renders.

## Consumer API (S1)
- **The JSON Schema describes only canonical forms**: decimals as `^-?\d+(?:\.\d+)?$` (string or number), dates as `format: date` + YYYY-MM-DD, states as an enum of 51 codes. Tests check that whatever the schema accepts, render accepts too.
- **Notices route check order**: header missing (400) → header unregistered (403) → path consumer unregistered (404) → mismatch (403). A notices `since` with no zone is read as UTC.
- **Seeded revoke notices get `activeVersion` filled in** from the versions' dates.
- **Sample snippets name the template's most recent real consumer**, falling back to the first registered one ("coral").

## Usage UI (U2)
- **The template Usage tab spans the rail's column** (no rail on that tab), left edge aligned with the header, 48px right inset.
- **Narrow consumers table**: below ~58rem of card width, "Last render" hides when the Template column is present; the sparkline still shows recency.
- **The Failures chart on the template tab plots 30 days**, matching the "Succeeded" figure beside it.
- **Added beyond the brief:** a "Recent failures" table on the template tab, and Top templates labels link to each template's Usage tab.

## Simulator UI (U1)
- **Link and Relink are allowed with unmapped required variables**; a blocked sentence shows beside the button ("Map Annual fee to send.") and Send stays disabled.
- **Pinning is always to the Active version**; the version step is a read-only row (a consumer can't pin a superseded version).
- **Results headline counts renders** (customer × channel), not customers.
- **Small header buttons inside Coral panels are 28px**, not UCOMP's 32px: deliberate, part of the foreign look.
- **The results grid shows Coral's newest batch** even if the link changed since; its context line names the batch's own version.
