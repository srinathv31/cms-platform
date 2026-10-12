"use client";

import { useMemo, useState } from "react";
import { addCounts, diffChannelFields } from "@/domain/redline/channel-fields";
import { diffDocuments, nameChange } from "@/domain/redline/document";
import type { ReviewScreenData } from "@/server/queries/review-models";

/**
 * The Document view's redline: the two switches (Show changes, Changes only) and what the version differs
 * from its baseline by, in the body, in each channel's own fields, and in the name.
 */
export function useReviewChanges({
  baseline,
  version,
  liveName,
}: Pick<ReviewScreenData, "baseline" | "version" | "liveName">) {
  const [showChanges, setShowChanges] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);

  const redline = useMemo(
    () => (baseline ? diffDocuments(baseline.body, version.body) : null),
    [baseline, version.body],
  );
  // Each channel's own fields, as they stand and against the baseline: an email's subject, an alert's push and SMS
  // (with the SMS footer each version was submitted with, so a footer change is redlined too).
  const fieldsNow = useMemo(() => diffChannelFields(null, version), [version]);
  const fieldsRedline = useMemo(
    () => (baseline ? diffChannelFields(baseline, version) : null),
    [baseline, version],
  );
  const counts =
    redline && fieldsRedline
      ? addCounts(redline.counts, fieldsRedline.counts)
      : null;
  const changeCount = counts
    ? counts.added + counts.removed + counts.changed + counts.moved
    : 0;
  // The name is versioned: a rename against what customers get today is reviewed like the rest.
  const rename = nameChange(liveName, version.name);

  return {
    showChanges,
    setShowChanges,
    changesOnly,
    setChangesOnly,
    redline,
    /** The fields the Document view paints: with their redline when Show changes is on. */
    fields: showChanges && fieldsRedline ? fieldsRedline : fieldsNow,
    counts,
    changeCount,
    rename,
  };
}
