import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { StaticDocument } from "@/editor/components/static-document";
import { CORAL_DOC, CORAL_VARIABLES, DEPOSITS_DOC, DEPOSITS_VARIABLES, countUses } from "./fixtures";
import { WorkspaceMock } from "./workspace-mock";
import type { HeadsId, LayoutId, ViewId } from "./types";

export const metadata: Metadata = { title: "Workspace layout" };

/*
 * Dev-only layout study for the template workspace (header + tabs + document + Variables panel).
 * Not linked from the app. Deep links, handy for screenshots:
 *   /design/workspace?layout=grid|column|rail&view=draft|active|view&heads=serif|sans&chrome=0
 * `chrome=0` hides the dev bar so the frame is the true window.
 */

const LAYOUTS: LayoutId[] = ["grid", "column", "rail"];
const VIEWS: ViewId[] = ["draft", "active", "view"];
const HEADS: HeadsId[] = ["serif", "sans"];

function pick<T extends string>(value: string | string[] | undefined, allowed: T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.find((a) => a === v) ?? fallback;
}

export default function WorkspaceLayoutPage({ searchParams }: PageProps<"/design/workspace">) {
  // The documents are server-rendered once (StaticDocument, as in the real workspace) and handed
  // to the client mock as plain elements.
  const docs = {
    coral: <StaticDocument content={CORAL_DOC} variables={CORAL_VARIABLES} />,
    deposits: <StaticDocument content={DEPOSITS_DOC} variables={DEPOSITS_VARIABLES} />,
  };
  const uses = { coral: countUses(CORAL_DOC), deposits: countUses(DEPOSITS_DOC) };

  return (
    <Stream fallback={null}>
      <Study searchParams={searchParams} docs={docs} uses={uses} />
    </Stream>
  );
}

async function Study({
  searchParams,
  docs,
  uses,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  docs: React.ComponentProps<typeof WorkspaceMock>["docs"];
  uses: React.ComponentProps<typeof WorkspaceMock>["uses"];
}) {
  const q = await searchParams;
  return (
    <WorkspaceMock
      docs={docs}
      uses={uses}
      initial={{
        layout: pick(q.layout, LAYOUTS, "grid"),
        heads: pick(q.heads, HEADS, "serif"),
        view: pick(q.view, VIEWS, "draft"),
        chrome: q.chrome !== "0",
      }}
    />
  );
}
