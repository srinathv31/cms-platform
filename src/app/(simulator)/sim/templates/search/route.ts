import { connection } from "next/server";
import { searchSimTemplates } from "@/simulator/queries";
import { simReadResponse } from "@/simulator/read-response";

// GET /sim/templates/search?q=: the link flow's search, debounced in the browser. Active templates from
// Stencil's /api/v1, empty `q` for all of them → { ok: true, results } | { ok: false, reason } with 400
// (q too long) or 502 (Stencil refused or couldn't be reached). A read, so a route handler and not a server
// action (decision 0019). Request-time only.

export async function GET(request: Request) {
  await connection();
  return simReadResponse(
    await searchSimTemplates(new URL(request.url).searchParams.get("q")),
  );
}
