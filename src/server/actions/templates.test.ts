import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JUST_CREATED_COOKIE } from "@/domain/arrival-cookies";
import { REFUSALS } from "@/domain/lifecycle/refusals";
import type { DraftContent } from "@/domain/lifecycle/types";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import { prepareBody } from "@/server/documents/prepare";
import { services } from "@/server/services";
import { fakeBackendPerTest } from "@/server/services/fake/testing";
import { refusal } from "@/server/services/results";
import type { NewTemplateType } from "@/server/services/templates";
import type { StarterChoice } from "@/server/starters";
import { createTemplate } from "./create-template";
import { startDraft } from "./templates";

// New template and Edit as the BFF runs them, against the in-memory fake (decision 0068): what the actions add to
// the backend is the input's parse, the team's slug resolved to its id, the first draft built and prepared for the
// content type the backend names, the answer, the cookie, the redirect and what refreshes. What the backend
// decides (who may create, the draft it stores, Edit's rules) is the contract suite's
// (src/server/services/contract/templates.ts). The BFF reads no clock: this file fails if it does.
// Seed: Maya is an author on Coral Offers; Balance Transfer has an Active v2 and nothing newer.

vi.mock("@/server/services", () => import("@/server/services/fake/testing"));
vi.mock(
  "@/server/context/request",
  () => import("@/server/services/fake/testing"),
);
vi.mock("@/server/clock", () => ({
  now: () => {
    throw new Error("The BFF read the clock.");
  },
}));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  RedirectType: { replace: "replace", push: "push" },
}));

const BASE = new Date("2026-10-04T12:00:00.000Z");
const backend = fakeBackendPerTest({ base: BASE });

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
  jar.set.mockClear();
});

describe("startDraft", () => {
  const edit = (templateId = backend.templates["balance-transfer"]!) =>
    startDraft({ templateId });

  it("opens the draft in the workspace, replacing the page, and refreshes the lists that show it", async () => {
    backend.as("maya");
    const templateId = backend.templates["balance-transfer"]!;
    await edit();
    expect(redirect).toHaveBeenCalledWith(
      `/coral-offers/templates/${templateId}`,
      "replace",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/[team]/library", "page");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/[team]/templates/[templateId]",
      "layout",
    );
  });

  it("opens a draft that is open already without refreshing anything (a second click)", async () => {
    backend.as("maya");
    await edit();
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(redirect).mockClear();
    await edit();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers the service's refusal as it is, its sentence included, and neither redirects nor refreshes", async () => {
    backend.as("maya");
    expect(await edit(backend.templates["cash-back"]!)).toEqual({
      ok: false,
      ...REFUSALS.newerInReview,
    });
    backend.as("sam");
    expect(await edit()).toMatchObject({ ok: false, code: "generic" });
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses input that doesn't parse before asking the service, and nobody signed in", async () => {
    backend.as("maya");
    const spy = vi.spyOn(services().templates, "startDraft");
    expect(await startDraft({ templateId: "" })).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(spy).not.toHaveBeenCalled();
    backend.signOut();
    expect(await edit()).toEqual({ ok: false, ...REQUEST_REFUSALS.signedOut });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("createTemplate", () => {
  const document = (
    starterKey:
      "blank" | "card_offer_terms" | "rate_change_notice" | "fee_schedule",
  ): StarterChoice => ({
    family: "document",
    starterKey,
  });
  const alert = (
    starterKey:
      "blank" | "payment_reminder" | "card_activity" | "statement_ready",
  ): StarterChoice => ({
    family: "message",
    starterKey,
  });

  /** Creates a template as Maya, and returns what the BFF sent the backend to store. */
  async function createFrom(choice: StarterChoice, teamSlug = "coral-offers") {
    const spy = vi.spyOn(services().templates, "create");
    const answer = await createTemplate({ teamSlug, ...choice });
    expect(answer).toEqual({ ok: true, templateId: expect.any(String) });
    const [, sent] = spy.mock.calls.at(-1)!;
    return sent;
  }

  /** The required sections of a body, as the editor's guard sees them. */
  const requiredHeadings = (body: DraftContent["body"]) =>
    (body.content ?? [])
      .filter((b) => b.type === "heading" && b.attrs?.requiredKey)
      .map((b) => [
        b.attrs!.requiredKey,
        (b.content ?? []).map((n) => n.text).join(""),
      ]);

  /** The content type the backend names, other than as seeded. */
  const typeNamed = (over: Partial<NewTemplateType>) =>
    vi.spyOn(services().templates, "newTemplateType").mockResolvedValue({
      ok: true,
      asOf: BASE.toISOString(),
      contentTypeId: "ct_disclosure",
      requiredSections: [
        { key: "offer_details", title: "Offer details" },
        { key: "rates_and_fees", title: "Rates and fees" },
        { key: "legal_notices", title: "Legal notices" },
      ],
      allowedChannels: ["pdf", "web", "email"],
      ...over,
    });

  it("builds the draft for the content type the backend names: the three Disclosure sections in the starter's order, block ids on every block", async () => {
    backend.as("maya");
    const sent = await createFrom(document("card_offer_terms"));
    expect(sent).toMatchObject({
      teamId: "t_coral",
      contentTypeId: "ct_disclosure",
    });
    const { draft } = sent;
    expect(requiredHeadings(draft.body)).toEqual([
      ["offer_details", "Offer details"],
      ["rates_and_fees", "Rates and fees"],
      ["legal_notices", "Legal notices"],
    ]);
    expect(draft).toMatchObject({
      name: "Card offer terms",
      starterKey: "card_offer_terms",
      channels: ["pdf", "web"],
      channelFields: {},
    });
    const ids = (draft.body.content ?? []).map((b) => b.attrs?.id);
    expect(ids.every((id) => typeof id === "string" && id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // Ready for storage: the document check would change nothing.
    expect(prepareBody(draft.body)).toEqual({ ok: true, doc: draft.body });
  });

  it("opens the new template in the workspace, arriving with the name selected, and refreshes the Library", async () => {
    backend.as("maya");
    const spy = vi.spyOn(services().templates, "create");
    const answer = await createTemplate({
      teamSlug: "coral-offers",
      ...document("blank"),
    });
    if (!answer.ok) throw new Error(answer.code);
    const templateId = (await spy.mock.results[0]!.value).templateId as string;
    expect(redirect).toHaveBeenCalledWith(
      `/coral-offers/templates/${templateId}`,
    );
    expect(jar.set).toHaveBeenCalledWith(
      JUST_CREATED_COOKIE,
      templateId,
      expect.objectContaining({ path: "/", sameSite: "lax" }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/[team]/library", "page");
  });

  it("makes Blank untitled, with no starter key and no variables", async () => {
    backend.as("maya");
    const { draft } = await createFrom(document("blank"));
    expect(draft).toMatchObject({
      name: "Untitled template",
      starterKey: null,
      variables: [],
      channelFields: {},
    });
    expect(requiredHeadings(draft.body)).toHaveLength(3);
  });

  it("sets the starter's sample dates from the backend's instant, not a clock of its own", async () => {
    backend.as("maya");
    backend.setClock(new Date("2027-01-15T09:00:00.000Z"));
    const { draft } = await createFrom(document("rate_change_notice"));
    // The notice's effective date is 30 days after the instant the backend read.
    expect(draft.sampleSets[0]!.values.effective_date).toBe("2027-02-14");
  });

  it("gives two templates from one starter block ids of their own", async () => {
    backend.as("maya");
    const first = await createFrom(document("fee_schedule"));
    const second = await createFrom(document("fee_schedule"));
    const idsOf = (sent: typeof first) =>
      new Set((sent.draft.body.content ?? []).map((b) => b.attrs?.id));
    expect([...idsOf(first)].filter((id) => idsOf(second).has(id))).toEqual([]);
  });

  it("makes an alert on the Alert content type, with Push and SMS on and the starter's fields", async () => {
    backend.as("maya");
    const sent = await createFrom(alert("payment_reminder"));
    expect(sent.contentTypeId).toBe("ct_alert");
    expect(sent.draft).toMatchObject({
      name: "Payment reminder",
      starterKey: "payment_reminder",
      channels: ["push", "sms"],
    });
    expect(Object.keys(sent.draft.channelFields).sort()).toEqual([
      "push",
      "sms",
    ]);
    expect(sent.draft.variables.map((v) => v.key)).toEqual([
      "first_name",
      "amount_due",
      "due_date",
    ]);
    // An alert's body is one empty paragraph: nothing renders from it.
    expect(sent.draft.body.content).toHaveLength(1);
    expect(sent.draft.body.content?.[0]?.type).toBe("paragraph");
  });

  it("makes a Blank alert untitled, with no starter key and no fields", async () => {
    backend.as("maya");
    const { draft } = await createFrom(alert("blank"));
    expect(draft).toMatchObject({
      name: "Untitled template",
      starterKey: null,
      channels: ["push", "sms"],
      channelFields: {},
      variables: [],
    });
  });

  it("fits the starter to the sections and channels the backend names now: renamed, removed and added sections, and a channel left out", async () => {
    backend.as("maya");
    typeNamed({
      requiredSections: [
        { key: "offer_details", title: "Offer details" },
        { key: "rates_and_fees", title: "Rates, fees and APR" },
        { key: "eligibility", title: "Eligibility" },
      ],
      allowedChannels: ["pdf", "web"],
    });
    const { draft } = await createFrom(document("rate_change_notice"));
    expect(requiredHeadings(draft.body)).toEqual([
      ["offer_details", "Offer details"],
      ["rates_and_fees", "Rates, fees and APR"],
      ["eligibility", "Eligibility"],
    ]);
    // Legal notices is an ordinary heading now, and the added section is last with a block id of its own.
    const legal = (draft.body.content ?? []).find(
      (b) =>
        b.type === "heading" &&
        (b.content ?? []).some((n) => n.text === "Legal notices"),
    );
    expect(legal?.attrs?.requiredKey ?? null).toBeNull();
    const added = (draft.body.content ?? []).at(-1)!;
    expect(added.attrs).toMatchObject({ level: 2, requiredKey: "eligibility" });
    expect(added.attrs?.id).toMatch(/^b_/);
    // The notice wants an email copy; the content type no longer allows Email.
    expect(draft.channels).toEqual(["pdf", "web"]);
  });

  it("answers the backend's refusal when no content type makes the kind, and sends nothing", async () => {
    backend.as("maya");
    vi.spyOn(services().templates, "newTemplateType").mockResolvedValue(
      refusal(409, REFUSALS.noContentType("message")),
    );
    const create = vi.spyOn(services().templates, "create");
    expect(
      await createTemplate({
        teamSlug: "coral-offers",
        ...alert("card_activity"),
      }),
    ).toEqual({ ok: false, ...REFUSALS.noContentType("message") });
    expect(create).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a team the viewer can't create on, a team they can't enter or that isn't there, and All teams", async () => {
    const create = vi.spyOn(services().templates, "create");
    const attempt = (slug: string) =>
      createTemplate({ teamSlug: slug, ...document("blank") });
    // Sam only views Coral Offers: the backend refuses the permission.
    backend.as("sam");
    expect(await attempt("coral-offers")).toMatchObject({
      ok: false,
      code: "generic",
    });
    // Maya may not enter Deposits, and "nowhere" is no team: both read as a space that isn't there.
    backend.as("maya");
    for (const slug of ["deposits", "nowhere"])
      expect(await attempt(slug), slug).toMatchObject({
        ok: false,
        code: "space_unavailable",
      });
    // Riley may enter All teams, which isn't a team to create in.
    backend.as("riley");
    expect(await attempt("all")).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.teamGone,
    });
    expect(create).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuses a starter of the other kind and nobody signed in, as input it can't use", async () => {
    backend.as("maya");
    const mixed = {
      teamSlug: "coral-offers",
      family: "message",
      starterKey: "fee_schedule",
    } as never;
    expect(await createTemplate(mixed)).toEqual({
      ok: false,
      ...REQUEST_REFUSALS.invalidInput(),
    });
    expect(
      await createTemplate({
        teamSlug: "coral-offers",
        family: "document",
        starterKey: "nope" as never,
      }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.invalidInput() });
    backend.signOut();
    expect(
      await createTemplate({ teamSlug: "coral-offers", ...document("blank") }),
    ).toEqual({ ok: false, ...REQUEST_REFUSALS.signedOut });
    expect(redirect).not.toHaveBeenCalled();
  });
});
