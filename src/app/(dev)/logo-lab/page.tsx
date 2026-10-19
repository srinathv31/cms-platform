import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogoLab } from "./logo-lab";

export const metadata: Metadata = { title: "Logo lab" };

// Static page, a 404 in production builds: the logo concepts side by side, in the sidebar's header and at both
// sizes. No request data.
export default function LogoLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LogoLab />;
}
