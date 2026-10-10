import { cn } from "@/lib/utils";
import type { StarterChoice, StarterKey } from "@/server/starters/catalog";

// A miniature of each starter. A document's is a sheet of its blocks: headings, lines, a variable chip, a
// list, a table, a notice. An alert's is the top of a phone: its push notification, then its text
// message in a bubble, with the chips where its variables sit. Decorative only (the card's name and
// description say what it is), so it is hidden from assistive tech.

type Piece =
  | { kind: "h"; w: string }
  | { kind: "line"; w: string }
  | { kind: "chip-line" }
  | { kind: "bullets"; count: number }
  | { kind: "table"; rows: number }
  | { kind: "callout" }
  | { kind: "space" };

const h = (w: string): Piece => ({ kind: "h", w });
const line = (w = "w-full"): Piece => ({ kind: "line", w });

const PIECES: Record<StarterKey<"document">, Piece[]> = {
  // Only the three required headings, with room to write under each.
  blank: [h("w-[34%]"), { kind: "space" }, h("w-[40%]"), { kind: "space" }, h("w-[30%]")],
  card_offer_terms: [
    h("w-[36%]"),
    line(),
    line("w-[84%]"),
    { kind: "bullets", count: 3 },
    h("w-[42%]"),
    { kind: "table", rows: 3 },
    h("w-[32%]"),
    line("w-[92%]"),
    { kind: "callout" },
  ],
  rate_change_notice: [
    h("w-[36%]"),
    { kind: "chip-line" },
    line("w-[90%]"),
    h("w-[42%]"),
    { kind: "table", rows: 3 },
    h("w-[32%]"),
    line("w-[88%]"),
    { kind: "callout" },
  ],
  fee_schedule: [
    h("w-[36%]"),
    line("w-[94%]"),
    { kind: "bullets", count: 2 },
    h("w-[42%]"),
    { kind: "table", rows: 5 },
    h("w-[32%]"),
    line("w-[86%]"),
  ],
};

/**
 * An alert's miniature: the push (a title, an optional subtitle, body lines) and the SMS (its lines,
 * then the locked footer every SMS ends with). A line is a width, or a chip between two short lines.
 * Blank has the two frames and nothing written but the footer.
 */
type Words = (string | "chip")[];
interface AlertPieces {
  title: string | null;
  subtitle?: string;
  body: Words;
  sms: Words;
}

const ALERT_PIECES: Record<StarterKey<"message">, AlertPieces> = {
  blank: { title: null, body: [], sms: [] },
  payment_reminder: { title: "w-[58%]", body: ["chip", "w-[70%]"], sms: ["chip", "w-[64%]"] },
  card_activity: { title: "w-[62%]", subtitle: "w-[44%]", body: ["chip", "w-[76%]"], sms: ["w-[92%]", "chip"] },
  statement_ready: { title: "w-[54%]", body: ["w-[94%]", "chip"], sms: ["chip", "w-[52%]"] },
};

const LINE = "h-[3px] rounded-full bg-hairline-strong";
const HEADING = "h-[5px] rounded-full bg-text/70";
const CHIP = "h-[9px] w-[22%] rounded-sm border border-chip-border bg-chip";

function Mini({ piece }: { piece: Piece }) {
  switch (piece.kind) {
    case "h":
      return <div className={cn("mt-1", HEADING, piece.w)} />;
    case "line":
      return <div className={cn(LINE, piece.w)} />;
    case "chip-line":
      return (
        <div className="flex items-center gap-1">
          <div className={cn(LINE, "w-[26%]")} />
          <div className={CHIP} />
          <div className={cn(LINE, "w-[30%]")} />
        </div>
      );
    case "bullets":
      return (
        <div className="flex flex-col gap-1.5 pl-1">
          {Array.from({ length: piece.count }, (_, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="size-[3px] shrink-0 rounded-full bg-hairline-strong" />
              <div className={cn(LINE, i === 1 ? "w-[78%]" : "w-[90%]")} />
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="overflow-hidden rounded-sm border border-hairline">
          {Array.from({ length: piece.rows }, (_, row) => (
            <div
              key={row}
              className={cn("grid grid-cols-[1.4fr_1fr] gap-px bg-hairline", row > 0 && "border-t border-hairline")}
            >
              <div className={cn("flex h-[9px] items-center px-1", row === 0 ? "bg-surface-tinted" : "bg-surface")}>
                <div className={cn(LINE, "w-[70%]", row === 0 && "bg-text-subtle")} />
              </div>
              <div className={cn("flex h-[9px] items-center px-1", row === 0 ? "bg-surface-tinted" : "bg-surface")}>
                <div className={cn(LINE, row % 2 ? "w-[46%]" : "w-[62%]", row === 0 && "bg-text-subtle")} />
              </div>
            </div>
          ))}
        </div>
      );
    case "callout":
      return (
        <div className="flex flex-col gap-1.5 rounded-sm border border-hairline bg-surface-tinted px-1.5 py-1.5">
          <div className={cn(LINE, "w-full")} />
          <div className={cn(LINE, "w-[60%]")} />
        </div>
      );
    case "space":
      return <div className="h-4" />;
  }
}

/** A line of words: a width, or a chip with short lines either side. */
function WordsLine({ words }: { words: Words[number] }) {
  if (words !== "chip") return <div className={cn(LINE, words)} />;
  return (
    <div className="flex items-center gap-1">
      <div className={cn(LINE, "w-[30%]")} />
      <div className={CHIP} />
      <div className={cn(LINE, "w-[24%]")} />
    </div>
  );
}

function AlertMini({ pieces }: { pieces: AlertPieces }) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* The push, as a notification: the app's mark, then its title, subtitle and body. */}
      <div className="flex gap-1.5 rounded-lg border border-hairline bg-surface-tinted p-1.5">
        <div className="size-3.5 shrink-0 rounded-[4px] bg-text/70" />
        <div className="flex min-h-7 min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
          {pieces.title ? <div className={cn("h-[4px] rounded-full bg-text/70", pieces.title)} /> : null}
          {pieces.subtitle ? <div className={cn(LINE, "bg-text-subtle", pieces.subtitle)} /> : null}
          {pieces.body.map((words, i) => (
            <WordsLine key={i} words={words} />
          ))}
        </div>
      </div>
      {/* The SMS, as an incoming bubble: its lines, then the footer it always ends with. */}
      <div className="flex w-[82%] flex-col gap-1.5 rounded-lg rounded-bl-sm bg-surface-tinted px-1.5 py-1.5">
        {pieces.sms.map((words, i) => (
          <WordsLine key={i} words={words} />
        ))}
        <div className={cn(LINE, "w-[74%] bg-text-subtle/50")} />
      </div>
    </div>
  );
}

/**
 * A small sheet of paper showing a document starter's shape, or the top of a phone showing an alert
 * starter's push and SMS. Fixed height; the bottom fades out.
 */
export function StarterPreview({ starter, className }: { starter: StarterChoice; className?: string }) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-xl bg-surface-tinted px-5 pt-4", className)}>
      <div
        className={cn(
          "relative h-full overflow-hidden border border-b-0 border-hairline bg-surface px-3 pt-3",
          starter.family === "message" ? "rounded-t-2xl" : "rounded-t-md",
        )}
      >
        {starter.family === "message" ? (
          <AlertMini pieces={ALERT_PIECES[starter.starterKey]} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {PIECES[starter.starterKey].map((piece, i) => (
              <Mini key={i} piece={piece} />
            ))}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-surface to-transparent" />
      </div>
    </div>
  );
}
