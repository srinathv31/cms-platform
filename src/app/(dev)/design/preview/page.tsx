import type { Metadata } from "next";
import { Stream } from "@/components/primitives/stream";
import { StaticDocument } from "@/editor/components/static-document";
import { SPRING_DOC, VARIABLES } from "./fixtures";
import { PreviewMock } from "./preview-mock";
import type { ChannelId, DeviceId, ModeId, VariantId } from "./types";

export const metadata: Metadata = { title: "Preview split view" };

/*
 * Dev-only mock for the Preview split view next to the Rail layout. Not linked from the app.
 * Deep links, handy for screenshots:
 *   /design/preview?variant=a|b|c&mode=edit|preview&channel=pdf|web|email&device=desktop|mobile
 *                  &set=typical|long|minimum&chrome=0
 * `chrome=0` hides the dev bar so the frame is the true window.
 */

const VARIANTS: VariantId[] = ["a", "b", "c"];
const MODES: ModeId[] = ["edit", "preview"];
const CHANNELS: ChannelId[] = ["pdf", "web", "email"];
const DEVICES: DeviceId[] = ["desktop", "mobile"];
const SETS = ["typical", "long", "minimum"];

function pick<T extends string>(value: string | string[] | undefined, allowed: T[], fallback: T): T {
  const v = Array.isArray(value) ? value[0] : value;
  return allowed.find((a) => a === v) ?? fallback;
}

export default function PreviewMockPage({ searchParams }: PageProps<"/design/preview">) {
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
    <PreviewMock
      doc={doc}
      initial={{
        variant: pick(q.variant, VARIANTS, "a"),
        mode: pick(q.mode, MODES, "edit"),
        channel: pick(q.channel, CHANNELS, "pdf"),
        device: pick(q.device, DEVICES, "desktop"),
        setId: pick(q.set, SETS, "typical"),
        chrome: q.chrome !== "0",
      }}
    />
  );
}
