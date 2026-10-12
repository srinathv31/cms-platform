import type { SimRead } from "./types";

// The answer of a Coral GET route (the two reads the browser makes on demand: the template search and a
// delivery's customer view). The body is a `SimResult`, `{ ok: true, … }` or `{ ok: false, reason }`; a
// refusal also sets the HTTP status the read chose. Never cached: it is Coral's own rows and Stencil's
// answer of the moment.

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export function simReadResponse<T extends object>(
  result: SimRead<T>,
): Response {
  if (result.ok) return Response.json(result, { headers: HEADERS });
  const { status, ...body } = result;
  return Response.json(body, { status, headers: HEADERS });
}
