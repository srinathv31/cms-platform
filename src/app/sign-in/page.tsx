import type { Metadata } from "next";
import { PageHeader } from "@/components/primitives/page-header";

export const metadata: Metadata = { title: "Signed out" };

// Where a person with no session lands (`signInRequired()` in src/server/context/sign-in.ts). There is no
// sign-in yet: the persona switcher is a demo tool (decision 0051), so outside the demo nobody can sign in.
// Real sign-in (Better Auth, decision 0054) replaces this page with its own. Static: it reads no request.
export default function SignInPage() {
  return (
    <main className="mx-auto max-w-[40rem] px-6 py-24">
      <PageHeader title="You're signed out" />
      <p className="text-[14px] text-text-muted">
        Stencil&apos;s sign-in isn&apos;t connected in this build.
      </p>
    </main>
  );
}
