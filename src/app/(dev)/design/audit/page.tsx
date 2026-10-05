import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { AuditMock, type Variant } from "./audit-mock";
import { PRESETS } from "./data";
import { EMPTY, type Filters } from "./filters";

export const metadata: Metadata = { title: "Audit page" };

/*
 * Dev-only mock of the Audit page (/[team]/audit as the Auditor, all teams, read-only). Static fake
 * events, no server. Not linked from the app. Deep links, handy for screenshots:
 *   /design/audit?v=a|b|c&team=coral-offers,deposits&person=jordan&kind=approved,submitted
 *                &tmpl=cb&range=7|30|90&q=text&chrome=0
 */

const V: Variant[] = ["a", "b", "c"];

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}
const list = (v: string | string[] | undefined) => (first(v) ?? "").split(",").filter(Boolean);

export default function AuditMockPage({ searchParams }: PageProps<"/design/audit">) {
  return (
    <Stream fallback={null}>
      <Mock searchParams={searchParams} />
    </Stream>
  );
}

async function Mock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const preset = PRESETS.find((p) => p.id === first(q.range));
  const filters: Filters = {
    ...EMPTY,
    teams: list(q.team),
    people: list(q.person),
    kinds: list(q.kind),
    templates: list(q.tmpl),
    from: preset?.from ?? null,
    to: preset?.to ?? null,
    text: first(q.q) ?? "",
  };
  const v = first(q.v);
  return <AuditMock initial={{ variant: V.find((x) => x === v) ?? "a", filters, chrome: first(q.chrome) !== "0" }} />;
}
