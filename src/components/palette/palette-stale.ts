// "A template was just made": the shell's template list (the palette's `templates` prop) is read once
// per page load, so a draft made from a starter or an import isn't in it until a reload. The creators
// raise this signal; the palette refetches its space's list (/api/palette/{space}) the next time it
// opens. A module-level counter, shared by client components, like library-intent.ts.

let version = 0;

/** A template was just created: the palette's lists are out of date. */
export function markPaletteStale(): void {
  version += 1;
}

/** Changes whenever `markPaletteStale` is called. */
export function paletteStaleVersion(): number {
  return version;
}
