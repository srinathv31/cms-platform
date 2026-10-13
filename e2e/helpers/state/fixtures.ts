import type { Variable } from "../../api/helpers";
import { insert, select } from "./db";
import {
  newId,
  toColumns,
  type DocNode,
  type SampleSetRecord,
} from "./records";
import { removeTemplate } from "./templates";
import { addVersionLike, findVersion, templateById } from "./versions";

// Templates a spec makes for itself, so it never depends on (or disturbs) the seed's.

export const TEAM = "coral-offers";
export const SPRING_NAME = "Spring Travel Rewards — Terms";
/** Marks the fixture's template rows, so a run that died half way can be cleaned by the next one. */
const FIXTURE_MARK = "e2e-golive-fixture";
const DAY = 86_400_000;

export interface SpringFixture {
  templateId: string;
  v2Id: string;
  /** What v2 asks of a consumer, for the API calls and the mapping. */
  variables: Variable[];
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newTemplateId = () =>
  `UC-${Array.from({ length: 6 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join("")}`;

const variable = (key: string): DocNode => ({
  type: "variable",
  attrs: { key },
});
const text = (value: string): DocNode => ({ type: "text", text: value });

/** Removes Spring Travel Rewards (every template carrying the fixture's mark), whether or not it was finished. */
export async function removeSpringTravel(): Promise<void> {
  for (const stale of await select(
    "SELECT id FROM templates WHERE starter_key = ?",
    [FIXTURE_MARK],
  ))
    await removeTemplate(String(stale.id));
}

/**
 * Adds the template a person would have made in scenarios 2 and 3, already live: Maya's "Spring Travel Rewards —
 * Terms", v2 Active, with first_name, last_name, purchase_apr, home_state and an optional offer_end_date, on PDF,
 * Web and Email. It clones a seeded Coral version (Cash Back v2) for the body's structure, the sample sets and the
 * stage, and rewrites the offer text. A fixture left by a run that died is removed first. Use it through
 * `Changes.createSpringTravel`, which removes it again.
 */
export async function createSpringTravel(): Promise<SpringFixture> {
  await removeSpringTravel();

  const base = await findVersion({
    teamSlug: TEAM,
    name: "Cash Back Welcome Bonus — Terms",
    number: 2,
    state: "active",
  });
  if (!base)
    throw new Error(
      "The seed has no Cash Back Welcome Bonus v2 (Active) to clone. Run npm run db:reset.",
    );
  const baseTemplate = await templateById(base.templateId);
  if (!baseTemplate) throw new Error("The cloned version has no template.");

  const templateId = newTemplateId();
  const at = Date.now() - 3 * DAY;

  const body = structuredClone(base.body);
  // The offer text: first name and last name in the greeting (so the long name shows), then the terms.
  const greeting = body.content?.find((block) => block.type === "paragraph");
  if (!greeting) throw new Error("The cloned body has no paragraph.");
  greeting.content = [
    text("Hi "),
    variable("first_name"),
    text(" "),
    variable("last_name"),
    text(
      ", spend $1,000 on travel in your first 3 months and earn $200 back. Your purchase APR is ",
    ),
    variable("purchase_apr"),
    text("."),
  ];

  const variables = [
    {
      key: "first_name",
      label: "First name",
      type: "text",
      required: true,
      sample: "Maya",
    },
    {
      key: "last_name",
      label: "Last name",
      type: "text",
      required: true,
      sample: "Chen",
    },
    {
      key: "purchase_apr",
      label: "Purchase APR",
      type: "percent",
      required: true,
      sample: "21.99",
    },
    {
      key: "home_state",
      label: "Home state",
      type: "us_state",
      required: true,
      sample: "NJ",
    },
    {
      key: "offer_end_date",
      label: "Offer end date",
      type: "date",
      required: false,
      sample: "2026-11-19",
    },
  ];
  const keys = variables.map((v) => v.key);
  const sampleSets: SampleSetRecord[] = base.sampleSets.map((set) => ({
    ...set,
    values: Object.fromEntries(
      Object.entries(set.values).filter(([key]) => keys.includes(key)),
    ),
  }));

  await insert(
    "templates",
    toColumns("templates", {
      id: templateId,
      teamId: baseTemplate.teamId,
      contentTypeId: baseTemplate.contentTypeId,
      createdBy: "maya",
      createdAt: at - DAY,
      starterKey: FIXTURE_MARK,
    }),
  );

  const v2 = await addVersionLike(base, {
    templateId,
    number: 2,
    round: 1,
    state: "active",
    name: SPRING_NAME,
    basedOnVersionId: null,
    body,
    channelFields: {
      email: {
        subject: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                variable("first_name"),
                text(", your Spring Travel Rewards terms"),
              ],
            },
          ],
        },
        preheader: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [text("What to know before you spend.")],
            },
          ],
        },
      },
    },
    channels: ["pdf", "web", "email"],
    variables,
    sampleSets,
    contractChanges: null,
    currentStage: 0,
    rev: 0,
    createdBy: "maya",
    createdAt: at - DAY,
    updatedAt: at,
    submittedBy: "maya",
    submittedAt: at - 3_600_000,
    submitNote: null,
    activatedAt: at,
    supersededAt: null,
    sunsetAt: null,
    sunsetSetBy: null,
    revoke: null,
    importUploadId: null,
  });
  await insert(
    "approvals",
    toColumns("approvals", {
      id: newId("ap"),
      versionId: v2.id,
      stageId: "stage_disclosure_0",
      stagePosition: 0,
      stageName: "Team approver",
      actorId: "jordan",
      decision: "approved",
      reason: null,
      sampleSetsSeen: sampleSets.map((s) => s.id),
      decidedAt: at,
    }),
  );
  await insert(
    "audit_events",
    toColumns("audit_events", {
      id: newId("ae"),
      at,
      actorId: "jordan",
      teamId: baseTemplate.teamId,
      templateId,
      versionId: v2.id,
      action: "version.activated",
      details: { number: 2, supersedes: null, stage: "Team approver" },
    }),
  );
  return {
    templateId,
    v2Id: v2.id,
    variables: variables as unknown as Variable[],
  };
}
