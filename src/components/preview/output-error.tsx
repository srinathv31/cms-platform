"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RenderError } from "@/domain/render/types";
import type { Variable } from "@/domain/types";
import { authorMessage } from "./error-copy";

/**
 * A render the route refused, shown in the output area, in an author's words (error-copy.ts: the
 * variables by their labels, "First name needs a value."), and the one thing that can be done about
 * it. A problem with the values opens the sample-set editor; a failure on the server's side can be
 * tried again. Anything else (the template isn't visible, say) is just the route's sentence.
 */
export function OutputError({
  error,
  variables,
  onEditValues,
  onRetry,
}: {
  error: RenderError;
  /** The version's variables, for their labels. */
  variables: readonly Pick<Variable, "key" | "label">[];
  onEditValues: () => void;
  onRetry: () => void;
}) {
  const aboutValues = error.code === "missing_variables" || error.code === "invalid_values";
  const retryable = error.code === "render_failed";
  return (
    <div role="alert" className="grid min-h-full place-items-center px-8 py-12">
      <div className="flex max-w-80 flex-col items-center gap-4 text-center">
        <CircleAlert aria-hidden strokeWidth={1.5} className="size-7 text-text-subtle" />
        <p className="text-[14px] leading-6 text-text [overflow-wrap:anywhere]">{authorMessage(error, variables)}</p>
        {aboutValues ? (
          <Button variant="outline" className="bg-surface" onClick={onEditValues}>
            Edit values
          </Button>
        ) : retryable ? (
          <Button variant="outline" className="bg-surface" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
