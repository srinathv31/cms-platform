import { Lock } from "lucide-react";

// What a channel field wears around its text, wherever a message's fields are shown: the label over it
// (with a quiet tag, "iPhone only") and an SMS's locked footer inside its box. The composer
// (message-composer.tsx) and the review's and Compare's fields (redline/fields-document.tsx) share them,
// so a field looks the same being written, reviewed and compared. Server-safe: no hooks.

/**
 * The visible label over a field, 20px tall, and its tag. Hidden from assistive tech: the field (a
 * textbox in the composer, a group in the review) names itself with the field's full name ("Push title").
 */
export function FieldLabel({ label, tag }: { label: string; tag?: string | null }) {
  return (
    <div aria-hidden className="mb-2 flex h-5 items-center gap-2 text-[13px] leading-5 font-medium text-text-muted">
      {label}
      {tag ? <span className="rounded-sm border border-hairline px-1.5 text-[11px] leading-4 font-normal text-text-subtle">{tag}</span> : null}
    </div>
  );
}

/** The content type's SMS footer, under the message in the same box: sent as written, never edited here. */
export function LockedFooter({ text }: { text: string }) {
  return (
    <p data-slot="sms-footer" className="mt-0.5 flex items-start gap-1.5 text-text-muted select-none">
      <Lock role="img" aria-label="Locked" strokeWidth={1.75} className="mt-[5px] size-3.5 shrink-0 text-text-subtle" />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>
    </p>
  );
}
