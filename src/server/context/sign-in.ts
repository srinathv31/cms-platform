import "server-only";
import { redirect } from "next/navigation";

// Where a signed-out person goes: the one place real sign-in plugs in. Today the persona cookie is the only
// way in, so the page says the person is signed out; with Better Auth (decision 0054) this redirects to its
// sign-in, and nothing that calls it changes.

/** The signed-out page (src/app/sign-in/page.tsx). */
export const SIGN_IN_PATH = "/sign-in";

/** Stops a page that needs a signed-in person and sends them to sign in. */
export function signInRequired(): never {
  redirect(SIGN_IN_PATH);
}
