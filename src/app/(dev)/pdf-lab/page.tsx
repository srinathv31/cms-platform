import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdfLab } from "./pdf-lab";

export const metadata: Metadata = { title: "PDF lab" };

// Static page, a 404 in production builds. The viewer gets its bytes on the client: from the file input, or from
// ?src=<same-origin URL>.
export default function PdfLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PdfLab />;
}
