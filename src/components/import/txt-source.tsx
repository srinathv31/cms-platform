import { WELL_INSET } from "@/components/preview/well";

/** A .txt original, exactly as written: whitespace and line breaks kept, on a sheet in the well. */
export function TxtSource({ text }: { text: string }) {
  return (
    <div className={WELL_INSET}>
      <pre
        data-slot="original-sheet"
        className="rounded-xl border border-hairline bg-surface px-8 py-6 font-mono text-[13px] leading-6 whitespace-pre-wrap text-text [overflow-wrap:anywhere]"
      >
        {text}
      </pre>
    </div>
  );
}
