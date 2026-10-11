import { connection } from "next/server";
import { readSimDeliveryView } from "@/simulator/queries";
import { simReadResponse } from "@/simulator/read-response";

// GET /sim/deliveries/{deliveryId}/view: one delivery as its customer sees it (the drawer's phone, inbox or
// PDF), read when the drawer opens → { ok: true, view } | { ok: false, reason } with 404 (no such delivery).
// A read, so a route handler and not a server action (decision 0019). Request-time only: it reads Coral's
// table. The stored output itself is served by ../file.

export async function GET(_request: Request, ctx: RouteContext<"/sim/deliveries/[deliveryId]/view">) {
  await connection();
  const { deliveryId } = await ctx.params;
  return simReadResponse(await readSimDeliveryView(deliveryId));
}
