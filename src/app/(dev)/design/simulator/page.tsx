import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { SimMock } from "./sim-mock";
import type { Scenario, ScreenId, VariantId, ViewMode } from "./data";

export const metadata: Metadata = { title: "Consumer simulator" };

/*
 * Dev-only mock of the Coral consumer simulator (the real one is a full-page route outside the app
 * shell). Not linked from the app. Deep links, handy for screenshots:
 *   /design/simulator?v=a|b|c&screen=offers|link|map|send|customer|notices|relink
 *                    &scenario=live|v3|sunset|revoked&view=phone|inbox|pdf&sent=0|1&chrome=0
 * `chrome=0` hides the dev bar so the frame is the true window.
 */

const VARIANTS: VariantId[] = ["a", "b", "c"];
const SCREENS: ScreenId[] = ["offers", "link", "map", "send", "customer", "notices", "relink"];
const SCENARIOS: Scenario[] = ["live", "v3", "sunset", "revoked"];
const VIEWS: ViewMode[] = ["phone", "inbox", "pdf"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | string[] | undefined, allowed: T[], fallback: T): T {
  const v = first(value);
  return allowed.find((a) => a === v) ?? fallback;
}

export default function SimulatorMockPage({ searchParams }: PageProps<"/design/simulator">) {
  return (
    <Stream fallback={null}>
      <Mock searchParams={searchParams} />
    </Stream>
  );
}

async function Mock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const sent = first(q.sent);
  return (
    <SimMock
      initial={{
        variant: pick(q.v, VARIANTS, "a"),
        screen: pick(q.screen, SCREENS, "offers"),
        scenario: pick(q.scenario, SCENARIOS, "live"),
        view: pick(q.view, VIEWS, "phone"),
        chrome: first(q.chrome) !== "0",
        sent: sent === "1" ? true : sent === "0" ? false : undefined,
      }}
    />
  );
}
