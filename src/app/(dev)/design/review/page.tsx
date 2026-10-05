import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { ReviewMock } from "./review-mock";
import type { ActionsAt, DialogId, PersonaId, StageCount, VariantId, ViewId } from "./types";

export const metadata: Metadata = { title: "Review screen" };

/*
 * Dev-only mock of the review screen (/[team]/review/[templateId]/[version]). Not linked from the app.
 * Deep links, handy for screenshots:
 *   /design/review?variant=a|b&view=document|redline|preview&dialog=none|approve|request
 *                 &persona=jordan|maya&stages=1|2&actions=top|bottom&only=1&sunset=2027-03-01&chrome=0
 * `only=1` turns on Changes only (with view=redline), `sunset` opens Approve with that sunset date set,
 * `actions=bottom` pins Approve and Request changes under the rail instead of under the stepper, and
 * `chrome=0` hides the dev bar so the frame is the true window.
 */

const VARIANTS: VariantId[] = ["a", "b"];
const VIEWS: ViewId[] = ["document", "redline", "preview"];
const DIALOGS: DialogId[] = ["none", "approve", "request"];
const PERSONAS: PersonaId[] = ["jordan", "maya"];
const ACTIONS: ActionsAt[] = ["top", "bottom"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | string[] | undefined, allowed: T[], fallback: T): T {
  const v = first(value);
  return allowed.find((a) => a === v) ?? fallback;
}

export default function ReviewMockPage({ searchParams }: PageProps<"/design/review">) {
  return (
    <Stream fallback={null}>
      <Mock searchParams={searchParams} />
    </Stream>
  );
}

async function Mock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const variant = pick(q.variant, VARIANTS, "a");
  const sunset = first(q.sunset);
  return (
    <ReviewMock
      initial={{
        variant,
        // A opens on the document, B on the rendered output.
        view: pick(q.view, VIEWS, variant === "a" ? "document" : "preview"),
        dialog: pick(q.dialog, DIALOGS, sunset ? "approve" : "none"),
        persona: pick(q.persona, PERSONAS, "jordan"),
        stages: first(q.stages) === "2" ? (2 as StageCount) : (1 as StageCount),
        actions: pick(q.actions, ACTIONS, "top"),
        changesOnly: first(q.only) === "1",
        sunset: sunset && /^\d{4}-\d{2}-\d{2}$/.test(sunset) ? sunset : null,
        chrome: first(q.chrome) !== "0",
      }}
    />
  );
}
