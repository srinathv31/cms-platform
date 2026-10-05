import type { Metadata } from "next";
import { PdfLab } from "./pdf-lab";

export const metadata: Metadata = { title: "PDF lab" };

// Static page. The viewer gets its bytes on the client: from the file input, or from ?src=<same-origin URL>.
export default function PdfLabPage() {
  return <PdfLab />;
}
