import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: ["./src/server/db/schema/ucomp.ts", "./src/server/db/schema/sim.ts"],
  out: "./src/server/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/ucomp.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
