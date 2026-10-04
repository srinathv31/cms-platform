/**
 * A random id for one editing session. `crypto.randomUUID` exists only in secure contexts (https
 * and localhost), so a page opened over plain http on a LAN address falls back to random bytes.
 * Either form passes the route's session key check (8 to 64 letters, digits, `_` and `-`).
 */
export function newSessionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
