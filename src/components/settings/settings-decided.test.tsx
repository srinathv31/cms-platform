// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessZoneSection,
  ChannelRuleRow,
  ContentTypeView,
  InactivityRow,
  InactivitySection,
  MemberRow,
  MembersSection,
  RecertificationSection,
  RecertItemRow,
} from "@/domain/access-types";

// The settings screens render what the server decided: who may do what (`can`), what each action
// does (`consequences`), how a settled row reads. They never work a rule out themselves. The read
// models below are deliberately at odds with what the rules would say, so a screen that still
// computed its own answer would show it here.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/server/actions/access", () => ({
  changeMemberRoles: vi.fn(),
  decideAccessRequest: vi.fn(),
  decideRecertItem: vi.fn(),
  keepInactive: vi.fn(),
  reinstateMember: vi.fn(),
  removeMember: vi.fn(),
  startRecertification: vi.fn(),
  suspendInactive: vi.fn(),
}));
vi.mock("@/server/actions/platform", () => ({
  createTeam: vi.fn(),
  saveApprovalChain: vi.fn(),
  setBusinessZone: vi.fn(),
  setChannelRule: vi.fn(),
  updateContentType: vi.fn(),
}));

const { ChannelRulesSectionView } = await import("./platform/channel-rules");
const { ContentTypesSectionView } = await import("./platform/content-types");
const { InactivityView } = await import("./team/inactivity-view");
const { MembersTable } = await import("./team/members-table");
const { RecertificationView } = await import("./team/recertification-view");
const { TimeZoneSectionView } = await import("./platform/time-zone");

const OK = { ok: true } as const;
const TEAM = { id: "coral-offers", slug: "coral-offers", name: "Coral Offers" };
const person = (id: string, name: string) => ({ id, name, initials: name.slice(0, 2).toUpperCase(), hue: 0 });
const TODAY = "2026-10-04";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const show = (node: React.ReactNode) => act(async () => root.render(node));
const click = (el: Element | null) =>
  act(async () => {
    if (!el) throw new Error("nothing to click");
    (el as HTMLElement).click();
  });
const buttonNamed = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name) ?? null;
const strip = () => container.querySelector('[data-slot="consequence-strip"]');

describe("no settings screen decides a rule", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  const sources = files(join(process.cwd(), "src/components/settings")).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  // The domain's transitions write things: a screen asks the domain's validators and describers instead.
  const TRANSITIONS = new Set([
    "createTeam",
    "updateRequiredSections",
    "setChannelRule",
    "saveApprovalChain",
    "setBusinessZone",
    "requestAccess",
    "decideAccessRequest",
    "changeRoles",
    "removeMember",
    "suspendInactive",
    "keepInactive",
    "reinstate",
    "startRecert",
    "decideRecertItem",
    "sweepAccess",
  ]);

  it("reads every settings component", () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  it.each([
    ["calls can() or reads the permission rules", /from "@\/domain\/permissions"/],
    ["copies a refusal sentence", /\b(PLATFORM_REFUSALS|ACCESS_REFUSALS|REASONS|REFUSALS)\b/],
    ["reads a clock", /new Date\(|Date\.now\(/],
    ["makes up an actor", /actor:\s*\{/],
  ])("none %s", (_, pattern) => {
    expect(sources.filter((s) => pattern.test(s.text)).map((s) => s.path)).toEqual([]);
  });

  it("none runs a domain transition", () => {
    const misuse = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/domain\/[^"]+"/g)].flatMap((m) =>
        m[1]!
          .split(",")
          .map((name) => name.trim().replace(/^type\s+/, ""))
          .filter((name) => TRANSITIONS.has(name))
          .map((name) => `${path}: ${name}`),
      ),
    );
    expect(misuse).toEqual([]);
  });
});

describe("Channel rules", () => {
  const row = (toggle: ChannelRuleRow["can"]["toggle"]): ChannelRuleRow => ({
    contentTypeId: "ct_disclosure",
    name: "Disclosure",
    allowed: { pdf: true, web: true, email: true, push: false, sms: false },
    activeUsing: { pdf: 1, web: 1, email: 0, push: 0, sms: 0 },
    can: { toggle },
  });
  const family = { ok: false, code: "channel_family", reason: "Disclosures are documents. Push and SMS go on Alert templates." } as const;

  it("blocks exactly the switches the read model refuses: greyed in place, still focusable, with the reason", async () => {
    // Three channels on, so the rule alone would refuse none: the refusal here is the server's word.
    await show(
      <ChannelRulesSectionView
        section={{
          channels: ["pdf", "web", "email", "push", "sms"],
          rows: [row({ pdf: OK, web: { ok: false, code: "last_channel", reason: "Decided by the server." }, email: OK, push: family, sms: family })],
        }}
      />,
    );
    const sw = (label: string) => container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`)!;
    const reason = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
    for (const label of ["Disclosure on Web", "Disclosure on Push", "Disclosure on SMS"]) {
      const blocked = sw(label);
      expect(blocked.getAttribute("aria-disabled"), label).toBe("true");
      expect(blocked.hasAttribute("data-disabled"), `${label}: not disabled, so Tab reaches it and its reason`).toBe(false);
      expect(blocked.tabIndex, label).toBe(0);
    }
    expect(reason(sw("Disclosure on Web"))).toBe("Decided by the server.");
    // The other family's channels show greyed, not hidden, and say why.
    expect(reason(sw("Disclosure on Push"))).toBe(family.reason);
    for (const label of ["Disclosure on PDF", "Disclosure on Email"]) {
      expect(sw(label).hasAttribute("aria-disabled"), label).toBe(false);
      expect(sw(label).hasAttribute("aria-describedby"), label).toBe(false);
    }

    // Pressing a blocked switch does nothing: it doesn't flip, and asks for no turn-off.
    const { setChannelRule } = await import("@/server/actions/platform");
    await click(sw("Disclosure on Web"));
    expect(sw("Disclosure on Web").getAttribute("aria-checked")).toBe("true");
    expect(strip()).toBeNull();
    await click(sw("Disclosure on Push"));
    expect(sw("Disclosure on Push").getAttribute("aria-checked")).toBe("false");
    expect(setChannelRule).not.toHaveBeenCalled();

    // An unblocked one still asks before turning off.
    await click(sw("Disclosure on PDF"));
    expect(strip()).not.toBeNull();
  });
});

describe("Content types", () => {
  const type = (id: string, name: string, editSections: ContentTypeView["can"]["editSections"]): ContentTypeView => ({
    id,
    key: id,
    name,
    family: "document",
    requiredSections: [{ key: "terms", title: "Terms" }],
    allowedChannels: ["pdf", "web"],
    smsFooter: null,
    smsMaxParts: 3,
    templates: 1,
    can: { editSections },
  });

  it("keeps the Edit sections the read model refuses in place, greyed and still focusable, with its reason", async () => {
    const refused = { ok: false, code: "sections_on_messages", reason: "Decided by the server." } as const;
    await show(<ContentTypesSectionView types={[type("ct_a", "Notice", OK), type("ct_b", "Alert", refused)]} />);
    const blocked = buttonNamed("Edit Alert sections")!;
    expect(blocked.hasAttribute("disabled"), "not the native disabled: Tab would skip it and its reason").toBe(false);
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(blocked.hasAttribute("data-disabled")).toBe(true);
    expect(document.getElementById(blocked.getAttribute("aria-describedby")!)?.textContent).toBe("Decided by the server.");
    await click(blocked);
    expect(container.querySelector('[data-slot="sections-editor"]')).toBeNull();

    const open = buttonNamed("Edit Notice sections")!;
    expect(open.hasAttribute("aria-disabled")).toBe(false);
    await click(open);
    expect(container.querySelector('[data-slot="sections-editor"]')).not.toBeNull();
  });
});

describe("Time zone", () => {
  const section = (over: Partial<BusinessZoneSection> = {}): BusinessZoneSection => ({
    zone: "America/New_York",
    zones: [
      { id: "America/New_York", label: "Eastern (America/New_York)" },
      { id: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
    ],
    can: { change: OK },
    consequences: ["What stays put, as the server says."],
    ...over,
  });

  it("words the zone picked with the domain, then says what stays put as the read model sent it", async () => {
    await show(<TimeZoneSectionView section={section()} />);
    await click(buttonNamed("Change time zone"));
    expect(strip()?.textContent).not.toContain("What stays put");
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Business time zone"]')!;
    await act(async () => {
      select.value = "America/Los_Angeles";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(strip()?.textContent).toContain("New sunset dates end at 00:00 Pacific (America/Los_Angeles).");
    expect(strip()?.textContent).toContain("What stays put, as the server says.");
  });

  it("disables the change the read model refuses", async () => {
    await show(<TimeZoneSectionView section={section({ can: { change: { ok: false, code: "generic", reason: "Decided by the server." } } })} />);
    const opener = buttonNamed("Change time zone");
    expect(opener?.getAttribute("aria-disabled")).toBe("true");
    await click(opener);
    expect(strip()).toBeNull();
  });
});

describe("Members", () => {
  const member: MemberRow = {
    membershipId: "m_maya",
    person: person("maya", "Maya Chen"),
    title: "Content Author",
    email: "maya@example.com",
    roles: ["author"],
    status: "active",
    statusReason: null,
    statusChangedAt: null,
    lastActiveAt: "2026-10-03T12:00:00.000Z",
    addedAt: "2026-01-01T12:00:00.000Z",
    isYou: false,
    can: { editRoles: OK, remove: OK, reinstate: { ok: false, code: "membership_already_active", reason: "Already active." } },
    consequences: { remove: "What the server says Remove does.", reinstate: "What the server says Restore does." },
  };
  const section: MembersSection = { team: TEAM, rows: [member], roles: ["viewer", "author", "approver", "team_admin"], today: TODAY };

  it("the Remove strip says the line the read model sent", async () => {
    await show(<MembersTable section={section} />);
    await click(container.querySelector('[data-act="m_maya:remove"]'));
    expect(strip()?.textContent).toContain("What the server says Remove does.");
  });

  it("the roles editor words the change with the domain as roles are ticked", async () => {
    await show(<MembersTable section={section} />);
    await click(container.querySelector('[data-act="m_maya:roles"]'));
    expect(strip()?.textContent).toContain("Maya Chen will be Author on Coral Offers.");
    // Untick Author, the only role ticked (Base UI toggles through the checkbox's hidden input).
    await click(container.querySelector('[role="group"] [role="checkbox"][aria-checked="true"]')?.parentElement?.querySelector("input") ?? null);
    expect(strip()?.textContent).toContain("Maya needs at least one role on Coral Offers.");
    expect(buttonNamed("Save roles")?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Inactivity", () => {
  const flagged = (over: Partial<InactivityRow>): InactivityRow => ({
    membershipId: "m_devon",
    person: person("devon", "Devon Lin"),
    title: "Analyst",
    roles: ["viewer"],
    lastActiveAt: null,
    daysInactive: 95,
    suspendsAt: "2026-10-29T12:00:00.000Z",
    status: "active",
    statusReason: null,
    heldAsLastAdmin: false,
    can: { suspend: OK, keep: OK, reinstate: { ok: false, code: "membership_already_active", reason: "Already active." } },
    consequences: { suspend: "Suspend, as the server says.", keep: "Keep, as the server says.", reinstate: "Restore, as the server says." },
    ...over,
  });
  const section = (row: InactivityRow): InactivitySection => ({
    team: TEAM,
    flagged: [row],
    suspended: [],
    thresholds: { flagDays: 90, suspendDays: 120 },
  });

  it("says Kept active only when the read model says the sweep held them, whatever the day count", async () => {
    await show(<InactivityView section={section(flagged({ heldAsLastAdmin: true }))} today={TODAY} />);
    expect(container.textContent).toContain("Kept active");
    await show(<InactivityView section={section(flagged({ daysInactive: 125 }))} today={TODAY} />);
    expect(container.textContent).not.toContain("Kept active");
    expect(container.textContent).toContain("Oct 29");
  });

  it("the Keep strip says the line, and the date, the read model sent", async () => {
    await show(<InactivityView section={section(flagged({}))} today={TODAY} />);
    await click(container.querySelector('[data-act="m_devon:keep"]'));
    expect(strip()?.textContent).toContain("Keep, as the server says.");
  });
});

describe("Recertification", () => {
  const item = (over: Partial<RecertItemRow>): RecertItemRow => ({
    userId: "sam",
    person: person("sam", "Sam Ortiz"),
    title: "Analyst",
    roles: ["viewer"],
    lastActiveAt: null,
    decision: null,
    membership: "active",
    outcome: null,
    can: { decide: OK },
    consequences: { remove: "Remove, as the server says." },
    ...over,
  });
  const section = (items: RecertItemRow[], over: Partial<RecertificationSection> = {}): RecertificationSection => ({
    team: TEAM,
    current: {
      id: "rc_1",
      label: "Q4 2026",
      startsAt: "2026-10-01T12:00:00.000Z",
      dueAt: "2026-11-03T12:00:00.000Z",
      completedAt: null,
      phase: "open",
      progress: { total: items.length, decided: 0, kept: 0, removed: 0, pending: items.length, label: "" },
      items,
      lapsed: [],
      footnote: "The footnote the server wrote.",
    },
    can: { start: { ok: false, code: "recert_open", reason: "A review is already open." } },
    consequences: { start: "Start, as the server says." },
    today: TODAY,
    ...over,
  });

  it("shows the footnote and each settled row's outcome as sent; an open row keeps its actions", async () => {
    await show(<RecertificationView section={section([item({ outcome: "The outcome the server wrote." }), item({ userId: "jo", person: person("jo", "Jo Park") })])} />);
    expect(container.querySelector('[data-slot="recert-summary"]')?.textContent).toContain("The footnote the server wrote.");
    expect(container.textContent).toContain("The outcome the server wrote.");
    expect(container.querySelector('[data-act="sam:keep"]')).toBeNull();
    expect(container.querySelector('[data-act="jo:keep"]')).not.toBeNull();
    await click(container.querySelector('[data-act="jo:remove"]'));
    expect(strip()?.textContent).toContain("Remove, as the server says.");
  });

  it("the Start review strip says the line, with its deadline, the read model sent", async () => {
    await show(<RecertificationView section={{ ...section([]), current: null, can: { start: OK } }} />);
    await click(buttonNamed("Start review"));
    expect(strip()?.textContent).toContain("Start, as the server says.");
  });
});
