// The ids of the parts of one version's entry that focus moves to. They live here, not in the client
// islands, because the server component that draws the entry needs them too.

/** The entry's heading: where focus goes when the control that opened a dialog is gone. */
export const entryHeadingId = (versionId: string) => `version-${versionId}`;

/** The entry's "Revoke vN" button. */
export const entryRevokeId = (versionId: string) => `version-${versionId}-revoke`;
