import "server-only";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as ucomp from "./schema/ucomp";
import { createAppClient } from "@/lib/serialized-writes";

// Local SQLite file by default. Point DATABASE_URL at libsql://… (+ DATABASE_AUTH_TOKEN)
// to use Turso with no code change.
export const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/ucomp.db";

// Writes inside this process take turns, and SQLite waits out another process's lock instead of
// failing at once (`src/lib/serialized-writes.ts` says why a busy collision must never happen here).
// `…Serialized`: a dev server that cached the client before writes took turns makes a new one.
const globalForDb = globalThis as unknown as { __ucompLibsqlSerialized?: Client };

export const libsql =
  globalForDb.__ucompLibsqlSerialized ?? createAppClient({ url: DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });

if (process.env.NODE_ENV !== "production") globalForDb.__ucompLibsqlSerialized = libsql;

/** UCOMP database. Simulator code uses its own handle (src/simulator/db.ts). */
export const db = drizzle(libsql, { schema: ucomp });
export type Db = typeof db;
