import { Skeleton } from "@/components/ui/skeleton";
import { formatCount } from "@/domain/numbers";
import { plural } from "@/domain/plural";
import { PLATFORM_LABELS } from "@/domain/render/errors";
import type { PushRender, SmsRender } from "@/domain/render/types";
import { cn } from "@/lib/utils";
import { WELL_INSET } from "./well";

// TEMPORARY (Phase 1). The push and SMS output as plain resolved text in a card, so the preview shows
// a message channel honestly until the phone preview replaces it (Phase 2b: `src/components/device`,
// rendered in the browser through `renderMessage`). Nothing else should build on these.

const CARD = "rounded-xl border border-hairline bg-surface px-4 py-3";
const META = "mt-2 text-xs tabular-nums text-text-muted";

/** The push as each platform gets it: iPhone with its subtitle, Android without. */
export function PushOutput({ ios, android }: { ios: PushRender; android: PushRender }) {
  return (
    <div className={cn("flex flex-col gap-4", WELL_INSET)}>
      {(["ios", "android"] as const).map((platform) => {
        const push = platform === "ios" ? ios : android;
        return (
          <figure key={platform} className="m-0">
            <figcaption className="caps-label pb-2">{PLATFORM_LABELS[platform]}</figcaption>
            <div className={CARD}>
              <p className="text-sm font-semibold text-text">{push.title}</p>
              {push.subtitle ? <p className="text-sm text-text">{push.subtitle}</p> : null}
              <p className="text-sm text-text">{push.body}</p>
            </div>
            <p className={META}>{formatCount(push.payloadBytes)} bytes</p>
          </figure>
        );
      })}
    </div>
  );
}

/** The SMS exactly as sent, footer included, with its encoding and parts. */
export function SmsOutput({ sms }: { sms: SmsRender }) {
  return (
    <div className={WELL_INSET}>
      <figure className="m-0">
        <div className={CARD}>
          <p className="whitespace-pre-wrap break-words text-sm text-text">{sms.text}</p>
        </div>
        <figcaption className={META}>
          {sms.encoding} · {plural(sms.parts, "part")} · {plural(sms.characters, "character")}
        </figcaption>
      </figure>
    </div>
  );
}

/** Before the first render: the card's shape. */
export function MessageSkeleton() {
  return (
    <div aria-hidden className={WELL_INSET}>
      <div className={cn(CARD, "flex flex-col gap-2")}>
        <Skeleton className="h-3.5 w-1/2 bg-surface-sunken" />
        <Skeleton className="h-2.5 w-full bg-surface-sunken" />
        <Skeleton className="h-2.5 w-4/5 bg-surface-sunken" />
      </div>
    </div>
  );
}
