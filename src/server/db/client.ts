import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as ucomp from "./schema/ucomp";

// Local SQLite file by default. Point DATABASE_URL at libsql://… (+ DATABASE_AUTH_TOKEN)
// to use Turso with no code change.
export const DATABASE_URL = process.env.DATABASE_URL ?? "file:./data/ucomp.db";

const globalForDb = globalThis as unknown as { __ucompLibsql?: Client };

export const libsql =
  globalForDb.__ucompLibsql ??
  createClient({ url: DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });

if (process.env.NODE_ENV !== "production") globalForDb.__ucompLibsql = libsql;

/** UCOMP database. Simulator code uses its own handle (src/simulator/db.ts). */
export const db = drizzle(libsql, { schema: ucomp });
export type Db = typeof db;
