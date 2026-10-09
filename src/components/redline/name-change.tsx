import type { NameChange } from "@/domain/redline";
import { cn } from "@/lib/utils";

// A rename between two versions, in the redline's marks: the old name struck through on the danger
// tint, then the new one underlined on the positive tint (as in redline-mark.ts). The name is
// versioned, so the review, the submit dialog and Compare show a rename with the other changes.
// Screen readers don't announce <del> and <ins>, so the words are said too.

const DELETE = "box-decoration-clone bg-danger-soft text-danger-text line-through decoration-danger-text/70 decoration-1";
const INSERT = "box-decoration-clone bg-positive-soft text-text underline decoration-positive decoration-1 underline-offset-[0.2em]";

export function NameChangeLine({ change, className }: { change: NameChange; className?: string }) {
  return (
    <p data-slot="name-change" className={cn("text-[14px] leading-6 [overflow-wrap:anywhere] text-text", className)}>
      <span className="sr-only">Renamed from </span>
      <del className={DELETE}>{change.from}</del>
      <span aria-hidden className="mx-1.5 text-text-subtle">
        →
      </span>
      <span className="sr-only"> to </span>
      <ins className={INSERT}>{change.to}</ins>
    </p>
  );
}
