import { cn } from "@/lib/utils";
import type { StarterKey } from "@/server/starters/catalog";

// A miniature of each starter's blocks: headings, lines, a variable chip, a list, a table, a notice.
// Decorative only (the card's name and description say what it is), so it is hidden from assistive tech.

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

const PIECES: Record<StarterKey, Piece[]> = {
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

const LINE = "h-[3px] rounded-full bg-hairline-strong";

function Mini({ piece }: { piece: Piece }) {
  switch (piece.kind) {
    case "h":
      return <div className={cn("mt-1 h-[5px] rounded-full bg-text/70", piece.w)} />;
    case "line":
      return <div className={cn(LINE, piece.w)} />;
    case "chip-line":
      return (
        <div className="flex items-center gap-1">
          <div className={cn(LINE, "w-[26%]")} />
          <div className="h-[9px] w-[22%] rounded-sm border border-chip-border bg-chip" />
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

/** A small sheet of paper showing the starter's shape. Fixed height; the bottom fades out. */
export function StarterPreview({ starter, className }: { starter: StarterKey; className?: string }) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-xl bg-surface-tinted px-5 pt-4", className)}>
      <div className="relative h-full overflow-hidden rounded-t-md border border-b-0 border-hairline bg-surface px-3 pt-3">
        <div className="flex flex-col gap-1.5">
          {PIECES[starter].map((piece, i) => (
            <Mini key={i} piece={piece} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-surface to-transparent" />
      </div>
    </div>
  );
}
