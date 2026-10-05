import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { UsageMock } from "./usage-mock";
import type { ScopeId, VariantId } from "./data";

export const metadata: Metadata = { title: "Usage dashboard" };

/*
 * Dev-only study of the Usage dashboard (/[team]/usage) and the per-template Usage tab. Not linked
 * from the app. Deep links, handy for screenshots:
 *   /design/usage-dashboard?v=a|b|c&scope=team|template&tab=renders|errors|consumers&chrome=0
 * `tab` only applies to C. `chrome=0` hides the dev bar so the frame is the true window.
 */

const VARIANTS: VariantId[] = ["a", "b", "c"];
const SCOPES: ScopeId[] = ["team", "template"];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | string[] | undefined, allowed: T[], fallback: T): T {
  const v = first(value);
  return allowed.find((a) => a === v) ?? fallback;
}

export default function UsageMockPage({ searchParams }: PageProps<"/design/usage-dashboard">) {
  return (
    <Stream fallback={null}>
      <Mock searchParams={searchParams} />
    </Stream>
  );
}

async function Mock({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return (
    <UsageMock
      initial={{
        variant: pick(q.v, VARIANTS, "a"),
        scope: pick(q.scope, SCOPES, "team"),
        chrome: first(q.chrome) !== "0",
        tab: first(q.tab),
      }}
    />
  );
}
