import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { SettingsMock } from "./settings-mock";
import type { NavVariant, Viewer } from "./nav";
import type { Variant } from "./items";

export const metadata: Metadata = { title: "Settings modal" };

/*
 * Dev-only mock of the settings modal for Phase 6. Not linked from the app. Static fake data, no server.
 * Deep links, handy for screenshots:
 *   /design/settings?v=a|b|c&nav=a|b|c&section=members|access-requests|recertification|inactivity|teams|
 *                    content-types|channel-rules|approval-chains&viewer=both|alex|riley&day=0&chrome=0
 * v picks the section layout (a table rows, b list + detail, c card rows) and, unless `nav` is given,
 * the matching nav grouping. `day` advances the demo clock. `chrome=0` hides the dev bar.
 */

const V: Variant[] = ["a", "b", "c"];
const VIEWERS: Viewer[] = ["both", "alex", "riley"];
const SECTIONS = ["members", "access-requests", "recertification", "inactivity", "teams", "content-types", "channel-rules", "approval-chains"];

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
function pick<T extends string>(v: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const x = first(v);
  return allowed.find((a) => a === x) ?? fallback;
}

export default function SettingsMockPage({ searchParams }: PageProps<"/design/settings">) {
  return (
    <Stream fallback={null}>
      <Mock searchParams={searchParams} />
    </Stream>
  );
}

async function Mock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const variant = pick(q.v, V, "a");
  const day = Number(first(q.day));
  return (
    <SettingsMock
      initial={{
        variant,
        nav: pick(q.nav, V as NavVariant[], variant),
        section: pick(q.section, SECTIONS, "members"),
        viewer: pick(q.viewer, VIEWERS, "both"),
        day: Number.isFinite(day) ? day : 0,
        chrome: first(q.chrome) !== "0",
      }}
    />
  );
}
