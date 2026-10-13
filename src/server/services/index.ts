import "server-only";
import { assertNever } from "@/domain/assert-never";
import { BACKEND, type Backend } from "@/server/config";
import { localServices } from "./local";
import type { Services } from "./types";

// The one place the BFF gets its backend: `services()` answers the implementation `STENCIL_BACKEND` names
// (src/server/config.ts), built once per process. Server actions, read models and route handlers call it and
// pass the request context to every method; nothing else in the BFF imports an implementation.
//
// Tests swap it: a BFF test mocks this module with the in-memory fake (src/server/services/fake), and the
// contract suite builds each implementation itself.

export type { Services } from "./types";

function build(backend: Backend): Services {
  switch (backend) {
    case "local":
      return localServices();
    default:
      return assertNever(backend);
  }
}

let current: Services | undefined;

/** The backend this server runs on. */
export function services(): Services {
  return (current ??= build(BACKEND));
}
