import { WELL_INSET } from "@/components/preview/well";

/**
 * A .docx original: the server's allowlisted HTML (p, h1–h3, lists, tables, bold, italic, underline,
 * safe links, line breaks and data: images; src/server/import/dom.ts), set in the document's own type
 * (`.ucomp-doc`, the editor's styles) on a sheet in the well, so it reads like the draft beside it.
 */
export function DocxSource({ html }: { html: string }) {
  return (
    <div className={WELL_INSET}>
      <div
        data-slot="original-sheet"
        className="ucomp-surface rounded-xl border border-hairline bg-surface py-6 [--ucomp-doc-gutter:2rem] [&_img]:h-auto [&_img]:max-w-full"
      >
        {/* Allowlisted on the server when the file was imported; nothing else reaches this. */}
        <div className="ucomp-doc" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
