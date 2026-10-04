import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "@/server/db/client";

async function main() {
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
