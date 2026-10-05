// Focus styles for the values editor, in the editor's language (see the variable form): the app's
// crisp 2px `--focus-ring` outline, offset from the control, replacing shadcn's translucent halo.
// `outline-solid` because shadcn's controls set `outline-none`.

const RING =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-0";

/** Buttons. */
export const FOCUS_RING = `${RING} focus-visible:border-transparent`;

/** Inputs: their own border stays. */
export const FIELD_FOCUS_RING = `${RING} focus-visible:border-input`;
