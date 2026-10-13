// ID helpers. Runtime ids are random. The seed's row ids come from `seededId`, a function of the PRNG, so they
// stay stable from one reset to the next; its template ids are literals (decision 0069).
// Pure TypeScript: no server-only, no Node imports.

/** A source of numbers in [0, 1). `Math.random` or a seeded PRNG both fit. */
export type Random01 = () => number;

/** Crockford base32: no I, L, O or U, so ids survive being read aloud or retyped. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LOWER_CROCKFORD = CROCKFORD.toLowerCase();

export const TEMPLATE_ID_PATTERN = /^UC-[0-9A-HJKMNP-TV-Z]{6}$/;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function fromBytes(alphabet: string, length: number): string {
  // 32 symbols divide 256 evenly, so the modulo does not skew the distribution.
  return Array.from(randomBytes(length), (b) => alphabet[b % 32]).join("");
}

function fromRng(alphabet: string, length: number, rng: Random01): string {
  let out = "";
  for (let i = 0; i < length; i++)
    out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

/** Random id such as `th_k3f9a2x7q1`. */
export function newId(prefix: string, length = 10): string {
  return `${prefix}_${fromBytes(LOWER_CROCKFORD, length)}`;
}

/** Consumer-facing template id: `UC-` plus 6 Crockford base32 characters, e.g. `UC-4F7K2Q`. */
export function newTemplateId(): string {
  return `UC-${fromBytes(CROCKFORD, 6)}`;
}

/** Same shapes as `newId`, but a pure function of the PRNG (used by the seed). */
export function seededId(rng: Random01, prefix: string, length = 10): string {
  return `${prefix}_${fromRng(LOWER_CROCKFORD, length, rng)}`;
}
