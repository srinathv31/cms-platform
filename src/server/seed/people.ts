import type { PlatformRole } from "@/domain/types";
import type { SeedCtx } from "./context";
import { HOUR } from "./time";

// The eight switchable personas use the fixed ids from docs/agent-brief.md.
// Everyone else is a non-switchable user who makes the teams, access and inactivity stories real.

interface Person {
  id: string;
  name: string;
  title: string;
  hue: number;
  persona?: boolean;
  platformRole?: PlatformRole;
  /** How long ago they were last active, in hours. */
  activeHoursAgo: number;
}

export const PERSONA_IDS = ["maya", "jordan", "alex", "priya", "sam", "riley", "taylor", "morgan"] as const;

const PEOPLE: Person[] = [
  // Personas (build plan: "Seed personas")
  { id: "maya", name: "Maya Chen", title: "Senior Content Designer", hue: 28, persona: true, activeHoursAgo: 0.5 },
  { id: "jordan", name: "Jordan Ellis", title: "Offer Compliance Manager", hue: 212, persona: true, activeHoursAgo: 3 },
  { id: "alex", name: "Alex Kim", title: "Offers Operations Lead", hue: 152, persona: true, activeHoursAgo: 5 },
  { id: "priya", name: "Priya Raman", title: "Content Strategist", hue: 322, persona: true, activeHoursAgo: 20 },
  { id: "sam", name: "Sam Ortiz", title: "Product Manager, Offers", hue: 48, persona: true, activeHoursAgo: 30 },
  { id: "riley", name: "Riley Brooks", title: "Content Platform Owner", hue: 266, persona: true, platformRole: "platform_admin", activeHoursAgo: 8 },
  { id: "taylor", name: "Taylor Nguyen", title: "Internal Audit Analyst", hue: 190, persona: true, platformRole: "auditor", activeHoursAgo: 52 },
  { id: "morgan", name: "Morgan Lee", title: "Marketing Associate", hue: 96, persona: true, activeHoursAgo: 2 },

  // Deposits and Card Statements members (not switchable)
  { id: "naomi", name: "Naomi Reyes", title: "Deposits Content Lead", hue: 12, activeHoursAgo: 26 },
  { id: "eli", name: "Eli Hartman", title: "Content Writer, Deposits", hue: 240, activeHoursAgo: 7 },
  { id: "hana", name: "Hana Sato", title: "Statements Program Lead", hue: 172, activeHoursAgo: 44 },
  { id: "marcus", name: "Marcus Webb", title: "Statement Content Specialist", hue: 300, activeHoursAgo: 12 },

  // Coral Offers viewer who has not logged in for 95 days (the inactivity story)
  { id: "devon", name: "Devon Lin", title: "Business Analyst, Offers", hue: 70, activeHoursAgo: 95 * 24 },

  // Someone asking for access to Coral Offers
  { id: "chris", name: "Chris Morales", title: "Marketing Coordinator", hue: 130, activeHoursAgo: 70 },

  // Legal reviewer: seeded for the "add a Legal stage" stretch demo, not a persona yet
  { id: "dana", name: "Dana Park", title: "Legal Reviewer, Consumer Compliance", hue: 350, activeHoursAgo: 9 * 24 },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function seedPeople(ctx: SeedCtx) {
  for (const p of PEOPLE) {
    ctx.sink.users.push({
      id: p.id,
      name: p.name,
      email: `${p.name.toLowerCase().replace(" ", ".")}@ucomp.example`,
      initials: initials(p.name),
      avatarHue: p.hue,
      title: p.title,
      isPersona: p.persona ?? false,
      platformRole: p.platformRole ?? null,
      lastActiveAt: new Date(ctx.base - p.activeHoursAgo * HOUR),
    });
  }
}

export const userName = (id: string) => {
  const person = PEOPLE.find((p) => p.id === id);
  if (!person) throw new Error(`Seed: unknown user "${id}"`);
  return person.name;
};

