import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaletteTemplateRow } from "@/domain/import-types";
import { PALETTE_QUERY_MAX } from "@/domain/palette";
import { REASONS } from "@/domain/permissions";
import { REQUEST_REFUSALS } from "@/domain/refusals";
import type { SpaceFacts } from "@/domain/spaces";
import type { Viewer } from "@/domain/types";
import { findRequestContext } from "@/server/context/request";
import type { RequestContext } from "@/server/context/request";
import { readAnswer } from "@/server/testing/read-routes";
import type { PaletteFacts } from "@/server/services/templates";
import { GET } from "./route";

// The ⌘K palette's search as the BFF runs it, on facts: HTTP in, the route and `searchPalette` for real, HTTP out.
// The backend (`identity.space`, `templates.palette`) is stood in for by the answers below, so these tests check
// only what the BFF adds: who is asking (before anything is parsed), the parse, the request it hands the backend
// (the space's team by id, the search as typed, the template), the refusals it passes through, and the body it
// answers with. Who may see which templates, Recent, the ranking and the caps are the backend's, and the contract
// suite's.
//
// Facts used: Maya is signed in. Coral Offers (`coral-offers`, team `t_coral`) is a space she can enter, and so is
// All teams (`all`, no team); a team's id is never its slug (decision 0053). Any other slug is a team she can't see.

const mocks = vi.hoisted(() => ({ space: vi.fn(), palette: vi.fn() }));
vi.mock("@/server/services", () => ({
  services: () => ({
    identity: { space: mocks.space },
    templates: { palette: mocks.palette },
  }),
}));
vi.mock("@/server/context/request", async () => {
  const { REQUEST_REFUSALS, refuse } = await import("@/domain/refusals");
  const findRequestContext = vi.fn();
  return {
    findRequestContext,
    requestContextOrRefusal: async () => {
      const context = await findRequestContext();
      return context
        ? { ok: true, context }
        : refuse(REQUEST_REFUSALS.signedOut);
    },
  };
});

const maya: RequestContext = {
  viewer: { userId: "maya" } as Viewer,
  correlationId: "req_test",
  credential: { kind: "in_process", userId: "maya" },
};

const SPACES: Record<string, SpaceFacts> = {
  "coral-offers": {
    teamId: "t_coral",
    slug: "coral-offers",
    name: "Coral Offers",
    kind: "team",
    icon: "users",
    can: {
      viewAudit: { ok: true },
      manageMembers: { ok: true },
      managePlatform: { ok: true },
    },
  },
  all: {
    teamId: null,
    slug: "all",
    name: "All teams",
    kind: "all",
    icon: null,
    can: {
      viewAudit: { ok: true },
      manageMembers: { ok: true },
      managePlatform: { ok: true },
    },
  },
};
const INVALID = {
  ok: false,
  code: "invalid_search",
  reason: "This search can't be run.",
};
const NOT_YOURS = {
  ok: false,
  code: "space_unavailable",
  reason: "This team isn't available to you.",
};
const SIGNED_OUT = {
  ok: false,
  code: "signed_out",
  reason: "Sign in to continue.",
};

const cashBack: PaletteTemplateRow = {
  id: "UC-AAAAAA",
  name: "Cash Back Welcome Bonus — Terms",
  teamSlug: "coral-offers",
  teamName: "Coral Offers",
  status: "in_review",
};
const balanceTransfer: PaletteTemplateRow = {
  id: "UC-BBBBBB",
  name: "Balance Transfer Intro — Terms",
  teamSlug: "coral-offers",
  teamName: "Coral Offers",
  status: "active",
};

/** What the palette lists at rest for Maya: one recent template, one more by name; she may create here. */
function facts(over: Partial<PaletteFacts> = {}): { ok: true } & PaletteFacts {
  return {
    ok: true,
    query: "",
    can: { create: { ok: true } },
    current: false,
    recent: [cashBack],
    templates: [balanceTransfer],
    ...over,
  };
}

beforeEach(() => {
  mocks.space.mockReset().mockImplementation(async (_ctx, { slug }) => {
    const space = SPACES[slug];
    return space
      ? { ok: true, space }
      : { ok: false, status: 404, ...REQUEST_REFUSALS.spaceUnavailable };
  });
  mocks.palette.mockReset().mockResolvedValue(facts());
  vi.mocked(findRequestContext).mockReset().mockResolvedValue(maya);
});

/** GET /api/palette/{space}{query} through the route's handler. */
function search(space: string, query = "") {
  return GET(
    new NextRequest(
      `http://localhost/api/palette/${encodeURIComponent(space)}${query}`,
    ),
    {
      params: Promise.resolve({ space }),
    } as Parameters<typeof GET>[1],
  );
}

describe("GET /api/palette/[space]", () => {
  it("200 with the palette's facts as the wire body: who it was read for, the space as the URL names it, what the person may do", async () => {
    expect(await readAnswer(search("coral-offers"))).toEqual({
      status: 200,
      body: {
        ok: true,
        viewerId: "maya",
        space: "coral-offers",
        query: "",
        canCreate: true,
        current: false,
        recent: [cashBack],
        templates: [balanceTransfer],
      },
    });
  });

  it("canCreate is the decided permission's ok, and the query and current are the backend's", async () => {
    mocks.palette.mockResolvedValue(
      facts({
        query: "terms coral",
        can: { create: { ok: false, ...REASONS.generic } },
        current: true,
        recent: [],
        templates: [cashBack, balanceTransfer],
      }),
    );
    const { status, body } = await readAnswer(
      search("all", "?q=++Terms++Coral"),
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      viewerId: "maya",
      space: "all",
      query: "terms coral",
      canCreate: false,
      current: true,
      recent: [],
      templates: [cashBack, balanceTransfer],
    });
  });

  it("asks the backend for the space's team by id, as the person asking, with the search as typed and the template", async () => {
    await search("coral-offers", "?q=++Terms++Coral&template=UC-AAAAAA");
    expect(mocks.space).toHaveBeenCalledExactlyOnceWith(maya, {
      slug: "coral-offers",
    });
    expect(mocks.palette).toHaveBeenCalledExactlyOnceWith(maya, {
      teamId: "t_coral",
      q: "  Terms  Coral",
      templateId: "UC-AAAAAA",
    });
  });

  it("asks for what isn't given as null, and for every team in All teams", async () => {
    await search("all");
    expect(mocks.palette).toHaveBeenCalledExactlyOnceWith(maya, {
      teamId: null,
      q: null,
      templateId: null,
    });
  });

  it("401 signed_out when nobody is signed in, without asking the backend", async () => {
    vi.mocked(findRequestContext).mockResolvedValue(null);
    expect(await readAnswer(search("coral-offers"))).toEqual({
      status: 401,
      body: SIGNED_OUT,
    });
    expect(await readAnswer(search("coral-offers", "?q=balance"))).toEqual({
      status: 401,
      body: SIGNED_OUT,
    });
    expect(mocks.space).not.toHaveBeenCalled();
    expect(mocks.palette).not.toHaveBeenCalled();
  });

  it("400 for a search that doesn't parse: too long, or an empty or overlong template, without asking the backend", async () => {
    expect(
      await readAnswer(
        search("coral-offers", `?q=${"a".repeat(PALETTE_QUERY_MAX + 1)}`),
      ),
    ).toEqual({ status: 400, body: INVALID });
    expect(await readAnswer(search("coral-offers", "?template="))).toEqual({
      status: 400,
      body: INVALID,
    });
    expect(
      await readAnswer(search("coral-offers", `?template=${"U".repeat(65)}`)),
    ).toEqual({ status: 400, body: INVALID });
    expect(mocks.space).not.toHaveBeenCalled();
    expect(mocks.palette).not.toHaveBeenCalled();
  });

  it("a search of the longest length, and a template id of the longest, parse", async () => {
    expect(
      (
        await readAnswer(
          search(
            "coral-offers",
            `?q=${"a".repeat(PALETTE_QUERY_MAX)}&template=${"U".repeat(64)}`,
          ),
        )
      ).status,
    ).toBe(200);
  });

  it("404 space_unavailable for a space the backend doesn't know, without asking for the palette", async () => {
    expect(await readAnswer(search("deposits"))).toEqual({
      status: 404,
      body: NOT_YOURS,
    });
    // A team's id is not its slug (decision 0053): the backend resolves slugs only.
    expect(await readAnswer(search("t_coral"))).toEqual({
      status: 404,
      body: NOT_YOURS,
    });
    expect(mocks.palette).not.toHaveBeenCalled();
  });

  it("passes the backend's own 404 space_unavailable through", async () => {
    mocks.palette.mockResolvedValue({
      ok: false,
      status: 404,
      ...REQUEST_REFUSALS.spaceUnavailable,
    });
    expect(await readAnswer(search("coral-offers"))).toEqual({
      status: 404,
      body: NOT_YOURS,
    });
  });
});
