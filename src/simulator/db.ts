import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as sim from "@/server/db/schema/sim";

// Coral's own database handle. In the demo it shares UCOMP's file (DATABASE_URL), but it is a separate
// client that only knows the sim_* tables: the simulator never sees UCOMP's schema.

const url = process.env.DATABASE_URL ?? "file:./data/ucomp.db";

const globalForSim = globalThis as unknown as { __simLibsql?: Client };

export const simLibsql =
  globalForSim.__simLibsql ?? createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

if (process.env.NODE_ENV !== "production") globalForSim.__simLibsql = simLibsql;

export const simDb = drizzle(simLibsql, { schema: sim });
export type SimDb = typeof simDb;

function isBusy(error: unknown): boolean {
  const text = `${(error as { code?: unknown })?.code ?? ""} ${(error as Error)?.message ?? ""}`;
  return /SQLITE_BUSY|database is locked/i.test(text);
}

/**
 * Runs a write, retrying briefly while UCOMP's client holds the file lock (a render writes
 * render_log on the same SQLite file).
 */
export async function withBusyRetry<T>(write: () => Promise<T>, tries = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= tries || !isBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
    }
  }
}
