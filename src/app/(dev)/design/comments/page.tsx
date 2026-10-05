import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { StaticDocument } from "@/editor";
import { CommentsMock } from "./comments-mock";
import { SPRING_DOC, VARIABLES } from "./fixtures";
import type { ComposeId, ScreenId, VariantId } from "./types";

export const metadata: Metadata = { title: "Review comments" };

/*
 * Dev-only mock for review comments next to the Rail layout. Not linked from the app. Deep links,
 * handy for screenshots:
 *   /design/comments?variant=a|b|c&thread=open|none&compose=1|block|sel&resolved=1&screen=author|review&chrome=0
 * `thread=open` starts with one thread active (its block and quote highlighted); `compose=1` opens
 * the new-comment composer on a quote, `compose=block` on a whole block, `compose=sel` selects the
 * quote so the bubble shows;
 * `resolved=1` expands the Resolved group; `screen=review` is the approver's read-only frame.
 * `chrome=0` hides the dev bar so the frame is the true window.
 */

const VARIANTS: VariantId[] = ["a", "b", "c"];
const SCREENS: ScreenId[] = ["author", "review"];
const THREADS = ["open", "none"] as const;

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.find((a) => a === v) ?? fallback;
}

function composeOf(value: string | string[] | undefined): ComposeId {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "1" ? "open" : v === "block" ? "block" : v === "sel" ? "selection" : "off";
}

export default function CommentsMockPage({ searchParams }: PageProps<"/design/comments">) {
  // The document is server-rendered once (StaticDocument, as in the real workspace) and handed to
  // the client mock as a plain element.
  const doc = <StaticDocument content={SPRING_DOC} variables={VARIABLES} />;
  return (
    <Stream fallback={null}>
      <Mock searchParams={searchParams} doc={doc} />
    </Stream>
  );
}

async function Mock({
  searchParams,
  doc,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  doc: React.ReactNode;
}) {
  const q = await searchParams;
  return (
    <CommentsMock
      doc={doc}
      initial={{
        variant: pick(q.variant, VARIANTS, "a"),
        screen: pick(q.screen, SCREENS, "author"),
        thread: pick(q.thread, THREADS, "none"),
        compose: composeOf(q.compose),
        resolved: q.resolved === "1",
        chrome: q.chrome !== "0",
      }}
    />
  );
}
