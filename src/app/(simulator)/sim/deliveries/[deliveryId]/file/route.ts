import { connection } from "next/server";
import { loadDeliveryFile } from "@/simulator/queries";

// GET /sim/deliveries/{deliveryId}/file: what Coral received for one delivery, served from Coral's own
// table for the customer view (the phone frame and inbox iframes, the embedded PDF and "Open PDF").
// pdf → the PDF bytes · web → the HTML document · email → the email's HTML. 404 for a failed delivery.

// Stored documents have no scripts and load nothing; keep it that way when one is opened directly.
const DOCUMENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'";

export async function GET(_request: Request, { params }: { params: Promise<{ deliveryId: string }> }) {
  await connection(); // request time only: never prerendered or cached
  const { deliveryId } = await params;
  const file = await loadDeliveryFile(deliveryId);
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (!file) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response("No delivered file for this delivery.", { status: 404, headers });
  }
  headers.set("Content-Type", file.contentType);
  headers.set("Content-Disposition", `inline; filename="${file.filename}"`);
  if (file.contentType.startsWith("text/html")) headers.set("Content-Security-Policy", DOCUMENT_CSP);
  return new Response(file.body, { headers });
}
