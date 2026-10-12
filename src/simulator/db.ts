import "server-only";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as sim from "@/server/db/schema/sim";
import { createAppClient } from "@/lib/serialized-writes";

// Coral's own database handle. In the demo it shares UCOMP's file (DATABASE_URL), but it is a separate
// client that only knows the sim_* tables: the simulator never sees UCOMP's schema.

const url = process.env.DATABASE_URL ?? "file:./data/ucomp.db";

const globalForSim = globalThis as unknown as {
  __simLibsqlSerialized?: Client;
};

// Same file as UCOMP's client, so its writes take turns on the same process-wide lock and it waits
// the same way for another process's lock (see `src/lib/serialized-writes.ts`). That client is the one
// place a write waits; a write that still fails there is not retried.
export const simLibsql =
  globalForSim.__simLibsqlSerialized ??
  createAppClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

if (process.env.NODE_ENV !== "production")
  globalForSim.__simLibsqlSerialized = simLibsql;

export const simDb = drizzle(simLibsql, { schema: sim });
