// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApproverFacts } from "@/domain/access-types";
import type {
  ApprovalChainsSection,
  ApprovalChainView,
  ChainStageView,
} from "@/server/queries/access-models";
import { PLATFORM_REFUSALS } from "@/domain/platform-config/refusals";
import type { ApproverRule } from "@/domain/types";

// The chain editor decides nothing: it keeps a draft, asks the domain (`validateChain`,
// `describeChainChange`, `removeStageRefusal`) about it as it changes, and shows the answers where the
// person is working. What the editor does itself is the draft and where focus goes: the confirm's label,
// starting the draft over when the saved chain changes, and Esc on a stage nobody named.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const save = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/platform", () => ({ saveApprovalChain: save }));

const { ApprovalChainsSectionView } = await import("./approval-chains");

const APPROVER: ApproverRule = { kind: "team_role", role: "approver" };
const named = (userId: string): ApproverRule => ({ kind: "user", userId });

const stage = (
  id: string,
  position: number,
  name: string,
  rule: ApproverRule,
  waiting = 0,
): ChainStageView => ({
  id,
  position,
  name,
  rule,
  ruleLabel: rule.kind === "user" ? rule.userId : "Approver role",
  waiting,
});

const person = (id: string, name: string) => ({
  id,
  name,
  initials: name.slice(0, 2).toUpperCase(),
  hue: 0,
  title: "Analyst",
  teams: ["Coral Offers"],
});
const facts = (
  id: string,
  name: string,
  over: Partial<ApproverFacts> = {},
): ApproverFacts => ({
  id,
  name,
  platformRole: null,
  activeTeamRole: true,
  ...over,
});

/** Disclosure: Compliance (the Approver role, nothing waiting) then Legal (Dana, two versions waiting on it). */
const DISCLOSURE: ApprovalChainView = {
  contentTypeId: "ct_disclosure",
  name: "Disclosure",
  stages: [
    stage("st_compliance", 0, "Compliance", APPROVER),
    stage("st_legal", 1, "Legal", named("dana"), 2),
  ],
};
const ALERT: ApprovalChainView = {
  contentTypeId: "ct_alert",
  name: "Alert",
  stages: [stage("st_alert", 0, "Duty officer", APPROVER)],
};

const section = (
  over: Partial<ApprovalChainsSection> = {},
): ApprovalChainsSection => ({
  chains: [DISCLOSURE],
  people: [
    person("dana", "Dana Park"),
    person("jordan", "Jordan Ellis"),
    person("alex", "Alex Rivera"),
  ],
  approvers: [
    facts("riley", "Riley Admin", {
      platformRole: "platform_admin",
      activeTeamRole: false,
    }),
    facts("dana", "Dana Park"),
    facts("jordan", "Jordan Ellis"),
    facts("alex", "Alex Rivera"),
  ],
  viewerId: "riley",
  ...over,
});

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const show = (
  node: React.ReactNode = <ApprovalChainsSectionView section={section()} />,
) => act(async () => root.render(node));
const click = (el: Element | null) =>
  act(async () => {
    if (!el) throw new Error("nothing to click");
    (el as HTMLElement).click();
  });
const button = (name: string, within: ParentNode = container) =>
  [...within.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  ) ?? null;
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
const press = (el: Element, key: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

const chain = (name = "Disclosure") =>
  container.querySelector<HTMLElement>(
    `section[aria-label="${name} approval chain"]`,
  )!;
/** The stages in the order they are listed, by the name their Move buttons carry. */
const stageNames = (name = "Disclosure") =>
  [...chain(name).querySelectorAll("ol[aria-label] > li")].map((li) => {
    const up = [...li.querySelectorAll("button")].find((b) =>
      /^Move .* up$/.test(b.getAttribute("aria-label") ?? ""),
    );
    return up!.getAttribute("aria-label")!.replace(/^Move (.*) up$/, "$1");
  });
const strip = () =>
  container.querySelector<HTMLElement>('[data-slot="consequence-strip"]');
const confirm = () => {
  const buttons = [...strip()!.querySelectorAll("button")];
  return buttons[buttons.length - 1]!;
};
const problems = (kind: "name" | "reviewer") =>
  [...container.querySelectorAll(`[data-problem="${kind}"]`)].map(
    (p) => p.textContent,
  );
const card = (label: "Now" | "After") =>
  container.querySelector<HTMLElement>(`section[aria-label="${label}"]`)!;
const add = () => button("Add stage")!;
/** An `aria-disabled` control: greyed in place, still focusable (never the native `disabled`). */
const isGreyed = (el: Element) => el.getAttribute("aria-disabled") === "true";

describe("the chain as saved", () => {
  it("lists each stage in order, with who reviews it, and the chain in one line under the name", async () => {
    await show();
    expect(stageNames()).toEqual(["Compliance", "Legal"]);
    const items = [...chain().querySelectorAll("ol[aria-label] > li")];
    expect(items[0]!.textContent).toContain("Approver role");
    expect(items[1]!.textContent).toContain("Dana Park"); // the domain's label for the rule, from the read model's people
    const flow = chain().querySelector("ol:not([aria-label])")!;
    expect(flow.textContent).toBe("SubmittedComplianceLegalActive");
    expect(strip(), "nothing to confirm yet").toBeNull();
  });

  it("keeps a draft for each chain on its own", async () => {
    await show(
      <ApprovalChainsSectionView
        section={section({ chains: [DISCLOSURE, ALERT] })}
      />,
    );
    await click(button("Add stage", chain("Alert")));
    expect(stageNames("Alert")).toHaveLength(2);
    expect(stageNames("Disclosure")).toEqual(["Compliance", "Legal"]);
  });

  it("greys the first stage's Move up and the last one's Move down, still focusable", async () => {
    await show();
    for (const [label, greyed] of [
      ["Move Compliance up", true],
      ["Move Compliance down", false],
      ["Move Legal up", false],
      ["Move Legal down", true],
    ] as const) {
      const b = button(label)!;
      expect(isGreyed(b), label).toBe(greyed);
      expect(b.hasAttribute("disabled"), `${label}: never natively`).toBe(
        false,
      );
    }
    await click(button("Move Compliance up"));
    expect(stageNames()).toEqual(["Compliance", "Legal"]);
    expect(strip()).toBeNull();
  });
});

describe("moving and removing", () => {
  it("moves a stage and says so in the strip, as 'Save chain'", async () => {
    await show();
    await click(button("Move Compliance down"));
    expect(stageNames()).toEqual(["Legal", "Compliance"]);
    expect(confirm().textContent).toBe("Save chain");
    expect(card("After").textContent).toMatch(/Legal.*Compliance/);
  });

  it("blocks Remove on a stage the domain says is still needed, in place, with the domain's reason", async () => {
    await show();
    const remove = button("Remove Legal")!;
    expect(isGreyed(remove)).toBe(true);
    expect(remove.hasAttribute("disabled")).toBe(false);
    // The reason is the tooltip on a focusable wrapper (`Blocked`).
    const wrapper = remove.parentElement!;
    expect(wrapper.tabIndex).toBe(0);
    await act(async () => wrapper.focus());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.body.textContent).toContain(
      PLATFORM_REFUSALS.stageWaiting(2, "Legal").reason,
    );
    await click(remove);
    expect(stageNames()).toEqual(["Compliance", "Legal"]);
    expect(strip()).toBeNull();
    // The other stage has nothing waiting on it: its Remove isn't greyed, and has no wrapper.
    expect(isGreyed(button("Remove Compliance")!)).toBe(false);
    expect(button("Remove Compliance")!.parentElement!.tabIndex).toBe(-1);
  });

  it("blocks the last stage's Remove: a chain keeps at least one stage", async () => {
    await show(
      <ApprovalChainsSectionView section={section({ chains: [ALERT] })} />,
    );
    const remove = button("Remove Duty officer")!;
    expect(isGreyed(remove)).toBe(true);
    await click(remove);
    expect(stageNames("Alert")).toEqual(["Duty officer"]);
  });

  it("asks the domain with the stage's own waiting count, and a new stage has none", async () => {
    // Legal is still waited on, so Remove Legal is blocked; add one, and the new stage's Remove isn't.
    await show();
    await click(add());
    const row = chain().querySelectorAll("ol[aria-label] > li")[2]!;
    const removeNew = [...row.querySelectorAll("button")].find((b) =>
      /^Remove /.test(b.getAttribute("aria-label") ?? ""),
    )!;
    expect(isGreyed(removeNew)).toBe(false);
    expect(isGreyed(button("Remove Legal")!), "still waited on").toBe(true);
  });

  it("removes a stage into a draft, names it in the confirm, and sends focus to Add stage", async () => {
    await show();
    await click(button("Remove Compliance"));
    expect(stageNames()).toEqual(["Legal"]);
    expect(confirm().textContent).toBe("Remove Compliance stage");
    expect(card("Now").textContent).toContain("Removed: Compliance");
    expect(document.activeElement).toBe(add());
  });
});

describe("the confirm's label", () => {
  it("names the stage when one is added and nothing else changes", async () => {
    await show();
    await click(add());
    await type(chain().querySelector("input")!, "  Risk  ");
    expect(confirm().textContent).toBe("Add Risk stage");
    expect(card("After").textContent).toContain("Added: Risk");
  });

  it("says 'Save chain', never 'Add stage', for a new stage nobody has named, and blocks it with the domain's sentence", async () => {
    await show();
    await click(add());
    expect(confirm().textContent).toBe("Save chain");
    expect(isGreyed(confirm())).toBe(true);
    expect(strip()!.textContent).toContain(PLATFORM_REFUSALS.stageName.reason);
    // Still being typed, so the name isn't flagged under its field.
    expect(problems("name")).toEqual([]);
  });

  it("says 'Save chain' when a stage is added and another is renamed or moved", async () => {
    await show();
    await click(add());
    await type(chain().querySelector("input")!, "Risk");
    expect(confirm().textContent).toBe("Add Risk stage");
    await click(button("Move Legal up"));
    expect(confirm().textContent).toBe("Save chain");

    await click(button("Move Compliance up"));
    await click(button("Edit Compliance"));
    const inputs = [...chain().querySelectorAll("input")];
    await type(inputs[inputs.length - 1]!, "Compliance review");
    expect(confirm().textContent).toBe("Save chain");
  });

  it("says 'Save chain' when a stage is removed and another is renamed", async () => {
    await show();
    await click(button("Remove Compliance"));
    expect(confirm().textContent).toBe("Remove Compliance stage");
    await click(button("Edit Legal"));
    await type(chain().querySelector("input")!, "Legal review");
    expect(confirm().textContent).toBe("Save chain");
  });

  it("says 'Save chain' when a stage is added and another removed", async () => {
    await show();
    await click(button("Remove Compliance"));
    await click(add());
    await type(chain().querySelector("input")!, "Risk");
    expect(confirm().textContent).toBe("Save chain");
  });

  it("says 'Save chain' for a rename, or when two stages are added", async () => {
    await show();
    await click(button("Edit Compliance"));
    await type(chain().querySelector("input")!, "Compliance review");
    expect(confirm().textContent).toBe("Save chain");

    await click(button("Discard"));
    await click(add());
    await type(chain().querySelector("input")!, "Risk");
    await click(add());
    const inputs = [...chain().querySelectorAll("input")];
    await type(inputs[inputs.length - 1]!, "Fraud");
    expect(confirm().textContent).toBe("Save chain");
  });

  it("is blocked, with the first problem beside it, while any stage has one", async () => {
    await show();
    await click(button("Edit Compliance"));
    await type(chain().querySelector("input")!, "Legal"); // the other stage's name
    expect(isGreyed(confirm())).toBe(true);
    expect(strip()!.textContent).toContain(
      PLATFORM_REFUSALS.stageDuplicate("Legal").reason,
    );
  });

  it("keeps the consequence lines back until the chain can be saved", async () => {
    await show();
    await click(button("Edit Compliance"));
    await choose(
      chain().querySelector<HTMLSelectElement>(
        'select[aria-label="Reviewer"]',
      )!,
      "user:jordan",
    );
    expect(strip()!.querySelector("ul")?.textContent).toContain(
      "Jordan Ellis will review",
    );
    await type(chain().querySelector("input")!, "Legal"); // now the name repeats the other stage's
    expect(isGreyed(confirm())).toBe(true);
    expect(strip()!.querySelector("ul")).toBeNull();
  });
});

describe("checking the draft with the read model's facts", () => {
  it("flags the name that repeats an earlier stage's, under its own field", async () => {
    await show();
    await click(button("Edit Legal"));
    await type(chain().querySelector("input")!, "compliance");
    expect(problems("name")).toEqual([
      PLATFORM_REFUSALS.stageDuplicate("compliance").reason,
    ]);
    const input = chain().querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(input.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(problems("name")[0]);
  });

  it("flags a person the read model's facts say can't approve, though they are on offer", async () => {
    await show(
      <ApprovalChainsSectionView
        section={section({
          approvers: [
            facts("riley", "Riley Admin", { platformRole: "platform_admin" }),
            facts("dana", "Dana Park"),
            facts("jordan", "Jordan Ellis", { platformRole: "auditor" }),
            facts("alex", "Alex Rivera"),
          ],
        })}
      />,
    );
    await click(button("Edit Compliance"));
    await choose(
      chain().querySelector<HTMLSelectElement>(
        'select[aria-label="Reviewer"]',
      )!,
      "user:jordan",
    );
    expect(problems("reviewer")).toEqual([
      PLATFORM_REFUSALS.auditorCantApprove("Jordan Ellis").reason,
    ]);
    expect(isGreyed(confirm())).toBe(true);
  });

  it("flags naming oneself, and a person on two stages", async () => {
    await show(
      <ApprovalChainsSectionView
        section={section({
          people: [...section().people, person("riley", "Riley Admin")],
        })}
      />,
    );
    await click(button("Edit Compliance"));
    const select = () =>
      chain().querySelector<HTMLSelectElement>(
        'select[aria-label="Reviewer"]',
      )!;
    await choose(select(), "user:riley");
    expect(problems("reviewer")).toEqual([
      PLATFORM_REFUSALS.nameYourself.reason,
    ]);

    // Dana already reviews the second stage. The later one is the stage that repeats her: its row says so.
    await choose(select(), "user:dana");
    const rows = chain().querySelectorAll("ol[aria-label] > li");
    const problemIn = (row: Element | undefined) =>
      row?.querySelector('[data-problem="reviewer"]')?.textContent ?? null;
    expect(problemIn(rows[0])).toBeNull();
    expect(problemIn(rows[1])).toBe(
      PLATFORM_REFUSALS.personTwice("Dana Park", 1).reason,
    );
  });

  it("offers the Approver role and the people, and keeps a role or a person who is no longer offered", async () => {
    await show(
      <ApprovalChainsSectionView
        section={section({
          chains: [
            {
              ...DISCLOSURE,
              stages: [
                stage("st_a", 0, "Authoring", {
                  kind: "team_role",
                  role: "author",
                }),
                stage("st_b", 1, "Old hand", named("sam")),
              ],
            },
          ],
          approvers: [...section().approvers, facts("sam", "Sam Ortiz")],
        })}
      />,
    );
    await click(button("Edit Authoring"));
    const select = chain().querySelector<HTMLSelectElement>(
      'select[aria-label="Reviewer"]',
    )!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Approver role",
      "Author role",
      "Dana Park · Coral Offers",
      "Jordan Ellis · Coral Offers",
      "Alex Rivera · Coral Offers",
    ]);
    expect(select.value).toBe("role:author");
    expect(problems("reviewer")).toEqual([
      PLATFORM_REFUSALS.roleCantApprove("author").reason,
    ]);

    await click(button("Done"));
    await click(button("Edit Old hand"));
    const sams = chain().querySelectorAll<HTMLSelectElement>(
      'select[aria-label="Reviewer"]',
    )[0]!;
    expect(sams.value).toBe("user:sam");
    expect([...sams.options].map((o) => o.textContent)).toContain("Sam Ortiz");
  });

  it("says who will review every team's submissions, as the domain words it, before anything is saved", async () => {
    await show();
    await click(button("Edit Compliance"));
    await choose(
      chain().querySelector<HTMLSelectElement>(
        'select[aria-label="Reviewer"]',
      )!,
      "user:jordan",
    );
    expect(strip()!.textContent).toContain(
      "Jordan Ellis will review Disclosure submissions from every team, including teams they aren't a member of.",
    );
    expect(isGreyed(confirm())).toBe(false);
  });
});

describe("saving, and starting over", () => {
  it("sends the whole chain in order: ids for the stages it had, none for a new one, names trimmed", async () => {
    await show();
    await click(add());
    await type(chain().querySelector("input")!, "  Risk ");
    // The button names the stage as typed, spaces and all.
    await click(
      [...chain().querySelectorAll("button")].find((b) =>
        /^Move\s+Risk\s+up$/.test(b.getAttribute("aria-label") ?? ""),
      )!,
    );
    await act(async () => confirm().focus());
    await click(confirm());
    expect(document.activeElement, "once saved, back to Add stage").toBe(add());
    expect(save).toHaveBeenCalledExactlyOnceWith({
      contentTypeId: "ct_disclosure",
      stages: [
        { id: "st_compliance", name: "Compliance", rule: APPROVER },
        { id: undefined, name: "Risk", rule: APPROVER },
        { id: "st_legal", name: "Legal", rule: named("dana") },
      ],
    });
  });

  it("shows the server's refusal beside the buttons and keeps the draft", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "stage_changed",
      reason: "A stage changed since you opened this. Try again.",
    });
    await show();
    await click(button("Remove Compliance"));
    await click(confirm());
    expect(strip()!.querySelector('[role="alert"]')?.textContent).toBe(
      "A stage changed since you opened this. Try again.",
    );
    expect(stageNames()).toEqual(["Legal"]);
  });

  it("discards the draft back to the saved chain, and sends focus to Add stage", async () => {
    await show();
    await click(button("Remove Compliance"));
    await click(button("Move Legal down"));
    // Pressed, Discard has focus, and takes it with it when the strip goes.
    await act(async () => button("Discard")!.focus());
    await click(button("Discard"));
    expect(stageNames()).toEqual(["Compliance", "Legal"]);
    expect(strip()).toBeNull();
    expect(document.activeElement).toBe(add());
  });

  it("starts the draft over when the saved chain changes: a save landed, or someone else edited it", async () => {
    await show();
    await click(button("Remove Compliance"));
    await click(button("Edit Legal"));
    expect(stageNames()).toEqual(["Legal"]);

    const saved: ApprovalChainView = {
      ...DISCLOSURE,
      stages: [
        stage("st_legal", 0, "Legal", named("dana"), 2),
        stage("st_risk", 1, "Risk", APPROVER),
      ],
    };
    await show(
      <ApprovalChainsSectionView section={section({ chains: [saved] })} />,
    );
    expect(stageNames()).toEqual(["Legal", "Risk"]);
    expect(strip(), "the draft matches what was saved").toBeNull();
    expect(chain().querySelector("input"), "no editor is left open").toBeNull();
  });

  it("keeps the draft when a refresh brings the same chain again", async () => {
    await show();
    await click(button("Remove Compliance"));
    // A new object with the same stages: the signature is the stages' content, not the object.
    const same: ApprovalChainView = {
      ...DISCLOSURE,
      stages: DISCLOSURE.stages.map((s) => ({ ...s })),
    };
    await show(
      <ApprovalChainsSectionView section={section({ chains: [same] })} />,
    );
    expect(stageNames()).toEqual(["Legal"]);
    expect(confirm().textContent).toBe("Remove Compliance stage");
  });

  it("doesn't start over for a change to what isn't the chain (the people on offer, how many wait)", async () => {
    await show();
    await click(button("Remove Compliance"));
    const waiting: ApprovalChainView = {
      ...DISCLOSURE,
      stages: DISCLOSURE.stages.map((s) => ({ ...s, waiting: 5 })),
    };
    await show(
      <ApprovalChainsSectionView section={section({ chains: [waiting] })} />,
    );
    expect(stageNames()).toEqual(["Legal"]);
  });
});

describe("Escape in a stage's editor", () => {
  const input = () => chain().querySelector("input")!;

  it("drops a new stage nobody named, and sends focus back to Add stage", async () => {
    await show();
    await click(add());
    expect(stageNames()).toHaveLength(3);
    expect(document.activeElement).toBe(input()); // the name field is focused on open
    await press(input(), "Escape");
    expect(stageNames()).toEqual(["Compliance", "Legal"]);
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(add());
    expect(strip()).toBeNull();
  });

  it("closes the editor but keeps a new stage that has a name, and focuses its Edit button", async () => {
    await show();
    await click(add());
    await type(input(), "Risk");
    await press(input(), "Escape");
    expect(stageNames()).toEqual(["Compliance", "Legal", "Risk"]);
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(button("Edit Risk"));
  });

  it("closes a saved stage's editor and keeps what was typed, and Done does the same", async () => {
    await show();
    await click(button("Edit Compliance"));
    await type(input(), "Compliance review");
    await press(input(), "Escape");
    expect(input()).toBeNull();
    expect(stageNames()).toEqual(["Compliance review", "Legal"]);
    expect(document.activeElement).toBe(button("Edit Compliance review"));

    await click(button("Edit Legal"));
    await click(button("Done"));
    expect(document.activeElement).toBe(button("Edit Legal"));
  });

  it("takes the Escape: Settings behind it doesn't see it, and sees every other key", async () => {
    const seen: string[] = [];
    await show(
      <div onKeyDown={(e) => seen.push(e.key)}>
        <ApprovalChainsSectionView section={section()} />
      </div>,
    );
    await click(button("Edit Compliance"));
    await press(input(), "a");
    await press(input(), "Escape");
    expect(seen).toEqual(["a"]);
    // With no editor open, an Escape is nobody's here: it goes on to close Settings.
    await press(chain(), "Escape");
    expect(seen).toEqual(["a", "Escape"]);
  });
});
