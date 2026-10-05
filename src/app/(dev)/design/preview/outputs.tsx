import { Lock, Menu } from "lucide-react";
import type { JSONContent } from "@/editor";
import { cn } from "@/lib/utils";
import { FitWidth } from "./fit-width";
import { EMAIL_PREHEADER, EMAIL_SUBJECT, SPRING_DOC, TEMPLATE_ID } from "./fixtures";
import { Blocks, inlineText, type Ctx, type Theme } from "./render-doc";
import type { ChannelId, DeviceId } from "./types";

/*
 * Realistic static fakes of what each channel renders. Each lays itself out at a fixed design width
 * (a Letter page is 816px, the email 680, the desktop page 960, the phone 390) and FitWidth shrinks
 * it to the pane, so the author sees the true layout at whatever width the split leaves.
 */

const PAGE = { w: 816, h: 1056 } as const;

// ── PDF ──────────────────────────────────────────────────────────

const PDF: Theme = {
  p: "mb-[11px] text-[14.5px] leading-[1.55]",
  h2: "mt-[22px] mb-[9px] font-display text-[22px] leading-[1.25]",
  h3: "mt-[16px] mb-[6px] text-[15px] font-medium",
  ul: "mb-[11px] list-disc pl-[22px] text-[14.5px] leading-[1.55]",
  ol: "mb-[11px] list-decimal pl-[22px] text-[14.5px] leading-[1.55]",
  li: "mb-[4px] pl-[2px]",
  table: "mb-[14px] w-full border-collapse text-[13.5px] leading-[1.45]",
  th: "border border-hairline bg-surface-tinted px-[12px] py-[8px] text-left font-medium",
  td: "border border-hairline px-[12px] py-[8px] align-top",
  callout: "mb-[14px] rounded-[6px] border border-hairline bg-surface-tinted px-[14px] py-[10px] text-[13.5px] leading-[1.5]",
  hr: "my-[16px] border-hairline",
  link: "underline",
};

/** Page 1 runs to the end of Rates and fees; Legal notices starts page 2. */
function paginate(blocks: JSONContent[]): JSONContent[][] {
  const at = blocks.findIndex((b) => b.type === "heading" && b.attrs?.requiredKey === "legal_notices");
  return at < 0 ? [blocks] : [blocks.slice(0, at), blocks.slice(at)];
}

function PdfPage({ n, of, blocks, ctx }: { n: number; of: number; blocks: JSONContent[]; ctx: Ctx }) {
  return (
    <div
      data-pdf-page=""
      className="relative overflow-hidden border border-hairline bg-surface text-text"
      style={{ width: PAGE.w, height: PAGE.h }}
    >
      <div className="absolute inset-x-[96px] top-[88px] bottom-[120px] overflow-hidden">
        {n === 1 ? (
          <div className="mb-[30px] flex items-baseline justify-between border-b border-hairline pb-[14px]">
            <span className="font-display text-[28px] leading-none">Coral</span>
            <span className="text-[11px] tracking-[0.08em] text-text-muted uppercase">Card offer terms</span>
          </div>
        ) : null}
        <Blocks blocks={blocks} ctx={ctx} theme={PDF} />
      </div>
      <div className="absolute inset-x-[96px] bottom-[52px] flex items-baseline justify-between border-t border-hairline pt-[12px] text-[11px] text-text-subtle">
        <span>
          <span className="font-mono">{TEMPLATE_ID}</span> · Draft
        </span>
        <span>
          Page {n} of {of}
        </span>
      </div>
    </div>
  );
}

export function PdfOutput({ ctx }: { ctx: Ctx }) {
  const pages = paginate(SPRING_DOC.content ?? []);
  return (
    <FitWidth width={PAGE.w}>
      <div className="flex flex-col gap-[24px]">
        {pages.map((blocks, i) => (
          <PdfPage key={i} n={i + 1} of={pages.length} blocks={blocks} ctx={ctx} />
        ))}
      </div>
    </FitWidth>
  );
}

// ── Web ──────────────────────────────────────────────────────────

function webTheme(compact: boolean): Theme {
  return {
    p: "mb-4 text-[16px] leading-[1.65]",
    h2: cn("mt-9 mb-3 font-display leading-[1.2]", compact ? "text-[25px]" : "text-[30px]"),
    h3: "mt-6 mb-2 text-[17px] font-medium",
    ul: "mb-4 list-disc pl-6 text-[16px] leading-[1.65]",
    ol: "mb-4 list-decimal pl-6 text-[16px] leading-[1.65]",
    li: "mb-1.5 pl-0.5",
    table: "mb-5 w-full border-collapse text-[15px] leading-[1.5]",
    th: "border border-hairline bg-surface-tinted px-3 py-2 text-left font-medium",
    td: "border border-hairline px-3 py-2 align-top",
    callout: "mb-5 rounded-lg border border-hairline bg-surface-tinted px-4 py-3 text-[15px] leading-[1.55]",
    hr: "my-6 border-hairline",
    link: "text-brand underline",
  };
}

const BROWSER_BAR =
  "flex h-10 items-center border-b border-hairline bg-surface-tinted px-4";

function UrlPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 text-[12px] text-text-muted",
        className,
      )}
    >
      <Lock aria-hidden strokeWidth={1.75} className="size-3" />
      coral.example/offers/spring-travel
    </div>
  );
}

export function WebOutput({ ctx, device }: { ctx: Ctx; device: DeviceId }) {
  const mobile = device === "mobile";
  const theme = webTheme(mobile);
  const blocks = SPRING_DOC.content ?? [];
  return (
    <FitWidth width={mobile ? 390 : 960}>
      <div
        data-web-frame={device}
        className={cn(
          "overflow-hidden border border-hairline bg-surface text-text",
          mobile ? "rounded-3xl" : "rounded-xl",
        )}
      >
        <div className={cn(BROWSER_BAR, mobile && "justify-center px-3")}>
          <UrlPill className={mobile ? "w-full justify-center" : "w-[360px]"} />
        </div>
        <div className={cn("flex items-center justify-between border-b border-hairline", mobile ? "h-14 px-5" : "h-16 px-10")}>
          <span className="font-display text-[26px] leading-none">Coral</span>
          {mobile ? (
            <Menu aria-hidden strokeWidth={1.75} className="size-5 text-text-muted" />
          ) : (
            <nav className="flex gap-8 text-[14px] text-text-muted">
              <span>Cards</span>
              <span>Rewards</span>
              <span>Help</span>
            </nav>
          )}
        </div>
        <div className={cn("mx-auto", mobile ? "px-5 pt-3 pb-8" : "max-w-[720px] px-10 pt-6 pb-14")}>
          <Blocks blocks={blocks} ctx={ctx} theme={theme} />
        </div>
        <div className={cn("border-t border-hairline text-[12px] leading-[1.6] text-text-subtle", mobile ? "px-5 py-6" : "px-10 py-8")}>
          Coral Bank, N.A. Member FDIC. Equal Housing Lender.
        </div>
      </div>
    </FitWidth>
  );
}

// ── Email ────────────────────────────────────────────────────────

const EMAIL: Theme = {
  p: "mb-3.5 text-[15px] leading-[1.6]",
  h2: "mt-7 mb-2.5 font-display text-[24px] leading-[1.25]",
  h3: "mt-5 mb-2 text-[16px] font-medium",
  ul: "mb-3.5 list-disc pl-5 text-[15px] leading-[1.6]",
  ol: "mb-3.5 list-decimal pl-5 text-[15px] leading-[1.6]",
  li: "mb-1 pl-0.5",
  table: "mb-4 w-full border-collapse text-[14px] leading-[1.45]",
  th: "border border-hairline bg-surface-tinted px-3 py-2 text-left font-medium",
  td: "border border-hairline px-3 py-2 align-top",
  callout: "mb-4 rounded-lg border border-hairline bg-surface-tinted px-4 py-3 text-[14px] leading-[1.5]",
  hr: "my-5 border-hairline",
  link: "text-brand underline",
};

export function EmailOutput({ ctx }: { ctx: Ctx }) {
  const subject = inlineText(EMAIL_SUBJECT, ctx);
  const preheader = inlineText(EMAIL_PREHEADER, ctx);
  const first = ctx.values.first_name ?? "";
  const last = ctx.values.last_name ?? "";
  return (
    <FitWidth width={680}>
      <div data-email-frame="" className="overflow-hidden rounded-xl border border-hairline bg-surface text-text">
        <div className="border-b border-hairline px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-[18px] text-brand">
              C
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] leading-5 font-medium">
                Coral Bank <span className="font-normal text-text-muted">&lt;offers@coralbank.example&gt;</span>
              </div>
              <div className="truncate text-[12px] leading-4 text-text-muted">
                to {first} {last}
              </div>
            </div>
            <span className="shrink-0 text-[12px] text-text-subtle">Mon 9:41 AM</span>
          </div>
          <h3 data-email-subject="" className="mt-4 text-[21px] leading-[1.3] font-medium [overflow-wrap:anywhere]">
            {subject}
          </h3>
          <p data-email-preheader="" className="mt-1 text-[13px] leading-5 text-text-muted">
            {preheader}
          </p>
        </div>
        <div className="bg-surface-tinted px-6 py-6">
          <div className="mx-auto max-w-[600px] rounded-lg border border-hairline bg-surface px-9 py-8">
            <div className="mb-6 border-b border-hairline pb-4 font-display text-[26px] leading-none">Coral</div>
            <Blocks blocks={SPRING_DOC.content ?? []} ctx={ctx} theme={EMAIL} />
            <div className="mt-6 border-t border-hairline pt-4 text-[12px] leading-[1.6] text-text-subtle">
              Coral Bank, N.A. Member FDIC. You are receiving this because you have an account with us.
            </div>
          </div>
        </div>
      </div>
    </FitWidth>
  );
}

// ── The one the panes mount ──────────────────────────────────────

export function Output({ channel, device, ctx }: { channel: ChannelId; device: DeviceId; ctx: Ctx }) {
  if (channel === "pdf") return <PdfOutput ctx={ctx} />;
  if (channel === "web") return <WebOutput ctx={ctx} device={device} />;
  return <EmailOutput ctx={ctx} />;
}
