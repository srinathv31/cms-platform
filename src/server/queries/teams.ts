import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { teams } from "@/server/db/schema/ucomp";

export interface TeamCard {
  slug: string;
  name: string;
  description: string;
  icon: string;
}

/** Every team, for the request-access page. */
export const getAllTeams = cache(async (): Promise<TeamCard[]> => {
  await connection(); // libSQL resolves in microtasks: keep this read out of the prerendered shell
  return db
    .select({ slug: teams.slug, name: teams.name, description: teams.description, icon: teams.icon })
    .from(teams)
    .orderBy(asc(teams.name));
});
