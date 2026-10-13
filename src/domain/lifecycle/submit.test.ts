import { describe, expect, it } from "vitest";
import { describeNotification } from "../notifications";
import { REFUSALS } from "./refusals";
import {
  answerChangeRequests,
  draftToSubmit,
  smsFooterOf,
  submit,
  submitFacts,
  type SubmitDraft,
  type SummaryRow,
} from "./submit";
import type { MessageTypeRules } from "../platform-config/limits";
import {
  DOCUMENT_THREAD,
  type ApprovalStage,
  type Recipients,
} from "../review-types";
import type { RoundRow } from "../rounds";
import type { JSONContent, Variable } from "../types";
import {
  NOW,
  TEMPLATE,
  CHAIN_1,
  NO_MESSAGE_RULES,
  heading,
  BODY,
  VARIABLES,
  SAMPLE_SETS,
} from "./fixtures";

describe("submit", () => {
  const chip = (key: string): JSONContent => ({
    type: "variable",
    attrs: { key },
  });
  const oneLine = (...inline: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content: inline }],
  });
  const text = (value: string): JSONContent => ({ type: "text", text: value });

  const draft: SubmitDraft = {
    state: "draft",
    variables: VARIABLES,
    body: BODY,
    channelFields: {},
    channels: ["pdf", "web"],
    sampleSets: SAMPLE_SETS,
    writers: ["maya"],
    rev: 7,
  };
  const SUBMITTER = "maya";
  const run = (
    over: Partial<SubmitDraft> = {},
    extra: {
      versions?: RoundRow[];
      baseline?: Variable[] | null;
      note?: string | null;
      chain?: ApprovalStage[];
      seenRev?: number;
      messageRules?: MessageTypeRules;
    } = {},
  ) =>
    submit({
      draft: { ...draft, ...over },
      seenRev: extra.seenRev ?? draft.rev,
      versions: extra.versions ?? [],
      baseline: extra.baseline ?? null,
      now: NOW,
      submittedBy: SUBMITTER,
      submitterName: "Maya Chen",
      templateId: TEMPLATE.id,
      templateName: TEMPLATE.name,
      note: extra.note,
      chain: extra.chain ?? CHAIN_1,
      messageRules: extra.messageRules ?? NO_MESSAGE_RULES,
    });

  const reviewRequested = (
    number: number,
    extra: { body?: string; to?: Recipients; round?: number } = {},
  ) => ({
    kind: "notification",
    notification: "review_requested",
    to: extra.to ?? {
      kind: "team_role",
      role: "approver",
      exceptUserIds: ["maya"],
    },
    facts: {
      actorName: "Maya Chen",
      templateName: TEMPLATE.name,
      number,
      round: extra.round ?? 1,
    },
    ...(extra.body ? { body: extra.body } : {}),
    link: {
      to: "review",
      templateId: TEMPLATE.id,
      versionNumber: number,
      ...((extra.round ?? 1) > 1 ? { round: extra.round } : {}),
    },
  });
  const submitted = (
    number: number,
    extra: {
      note?: string | null;
      contractChanges?: number;
      breaking?: boolean;
      round?: number;
    } = {},
  ) => ({
    kind: "audit",
    action: "version.submitted",
    details: {
      number,
      round: extra.round ?? 1,
      note: extra.note ?? null,
      contractChanges: extra.contractChanges ?? 0,
      breaking: extra.breaking ?? false,
    },
  });

  it("makes a first draft v1, in review, at the first approval stage", () => {
    const result = run();
    expect(result).toEqual({
      ok: true,
      changes: {
        state: "in_review",
        number: 1,
        round: 1,
        submittedBy: "maya",
        submittedAt: NOW,
        writers: ["maya"],
        submitNote: null,
        stages: [{ id: "st_team", name: "Team approver" }],
        currentStage: 0,
        contractChanges: null,
        smsFooter: null,
      },
      effects: [submitted(1), reviewRequested(1)],
    });
  });

  it("numbers the version one above the template's highest released number, as its first round", () => {
    const released = [1, 2, 3, 4].map(
      (number) =>
        ({
          number,
          round: 1,
          state: number === 4 ? "active" : "superseded",
        }) as const,
    );
    const result = run(
      {},
      {
        versions: [...released, { number: null, round: null, state: "draft" }],
      },
    );
    expect(result.ok && [result.changes.number, result.changes.round]).toEqual([
      5, 1,
    ]);
    expect(result.ok && result.effects).toEqual([
      submitted(5),
      reviewRequested(5),
    ]);
  });

  it("resubmits a number sent back as its next round, and says so: the label and the link name the round", () => {
    const sentBack = [
      { number: 1, round: 1, state: "changes_requested" },
      { number: null, round: null, state: "draft" },
    ] as const;
    const result = run({}, { versions: [...sentBack] });
    expect(result.ok && [result.changes.number, result.changes.round]).toEqual([
      1, 2,
    ]);
    expect(result.ok && result.effects).toEqual([
      submitted(1, { round: 2 }),
      reviewRequested(1, { round: 2 }),
    ]);
    // The notification keeps the round as a fact; read, it is worded with the round named.
    const notification = result.ok && result.effects[1];
    expect(
      notification &&
        notification.kind === "notification" &&
        describeNotification(
          notification.notification,
          notification.facts,
          "priya",
        ),
    ).toEqual({
      title:
        "Maya Chen submitted Spring Travel Rewards — Terms v1, round 2 for review.",
      body: null,
    });
    expect(
      notification && notification.kind === "notification" && notification.link,
    ).toEqual({
      to: "review",
      templateId: TEMPLATE.id,
      versionNumber: 1,
      round: 2,
    });
  });

  it("keeps the note to reviewers, trimmed, and passes it on to them", () => {
    const result = run(
      {},
      { note: "  Adds the annual fee for the spring launch.\n" },
    );
    expect(result.ok && result.changes.submitNote).toBe(
      "Adds the annual fee for the spring launch.",
    );
    expect(result.ok && result.effects).toEqual([
      submitted(1, { note: "Adds the annual fee for the spring launch." }),
      reviewRequested(1, {
        body: "Adds the annual fee for the spring launch.",
      }),
    ]);
  });

  it.each([undefined, null, "", "   \n "])(
    "stores no note when it is %j",
    (note) => {
      const result = run({}, { note });
      expect(result.ok && result.changes.submitNote).toBeNull();
      expect(result.ok && result.effects[1]).toEqual(reviewRequested(1));
    },
  );

  it("asks the team's approvers to review, never the submitter", () => {
    const result = run();
    expect(
      result.ok && result.effects.filter((e) => e.kind === "notification"),
    ).toEqual([reviewRequested(1)]);
  });

  it("asks nobody who wrote the draft", () => {
    const allWriters: Recipients = {
      kind: "team_role",
      role: "approver",
      exceptUserIds: ["priya", "maya"],
    };
    expect(run({ writers: ["priya"] })).toMatchObject({
      effects: [submitted(1), reviewRequested(1, { to: allWriters })],
    });
  });

  it("records the chain's stages in order, and asks whoever its first stage names", () => {
    const legalFirst: ApprovalStage[] = [
      {
        id: "st_team",
        position: 1,
        name: "Team approver",
        rule: { kind: "team_role", role: "approver" },
      },
      {
        id: "st_legal",
        position: 0,
        name: "Legal reviewer",
        rule: { kind: "user", userId: "dana" },
      },
    ];
    const result = run({}, { chain: legalFirst });
    expect(result).toMatchObject({
      effects: [
        submitted(1),
        reviewRequested(1, { to: { kind: "user", userId: "dana" } }),
      ],
    });
    expect(result.ok && result.changes.stages).toEqual([
      { id: "st_legal", name: "Legal reviewer" },
      { id: "st_team", name: "Team approver" },
    ]);
    expect(run({}, { chain: CHAIN_1 })).toMatchObject({
      effects: [submitted(1), reviewRequested(1)],
    });
  });

  it("records how many contract changes there are, and whether any breaks", () => {
    const annualFee: Variable = {
      key: "annual_fee",
      label: "Annual fee",
      type: "currency",
      required: true,
      sample: "95",
    };
    const breaking = run(
      { variables: [...VARIABLES, annualFee] },
      { baseline: VARIABLES },
    );
    expect(breaking.ok && breaking.effects[0]).toEqual(
      submitted(1, { contractChanges: 1, breaking: true }),
    );

    const relabelled = run(
      { variables: [{ ...VARIABLES[0]!, label: "Given name" }, VARIABLES[1]!] },
      { baseline: VARIABLES },
    );
    expect(relabelled.ok && relabelled.effects[0]).toEqual(
      submitted(1, { contractChanges: 1, breaking: false }),
    );
  });

  it("records no contract changes when there is no Active version to compare with", () => {
    const result = run({
      variables: [
        ...VARIABLES,
        {
          key: "annual_fee",
          label: "Annual fee",
          type: "currency",
          required: true,
          sample: "95",
        },
      ],
    });
    expect(result.ok && result.changes.contractChanges).toBeNull();
  });

  it("records the contract changes against the Active version's variables", () => {
    const annualFee: Variable = {
      key: "annual_fee",
      label: "Annual fee",
      type: "currency",
      required: true,
      sample: "95",
    };
    const result = run(
      { variables: [...VARIABLES, annualFee] },
      { baseline: VARIABLES },
    );
    expect(result.ok && result.changes.contractChanges).toEqual([
      {
        kind: "added",
        key: "annual_fee",
        breaking: true,
        type: "currency",
        required: true,
      },
    ]);

    const unchanged = run({}, { baseline: VARIABLES });
    expect(unchanged.ok && unchanged.changes.contractChanges).toEqual([]);
  });

  it("records a renamed variable as one key_renamed, from the identity it keeps as its id (D8)", () => {
    const apr: Variable = { ...VARIABLES[1]!, id: "purchase_apr", key: "apr" };
    const result = run(
      { variables: [VARIABLES[0]!, apr] },
      { baseline: VARIABLES },
    );
    expect(result.ok && result.changes.contractChanges).toEqual([
      {
        kind: "key_renamed",
        key: "apr",
        breaking: true,
        from: "purchase_apr",
        to: "apr",
      },
    ]);
    expect(result.ok && result.effects[0]).toEqual(
      submitted(1, { contractChanges: 1, breaking: true }),
    );
  });

  it("refuses a draft that changed after the summary was read, before anything else", () => {
    expect(run({}, { seenRev: 6 })).toEqual({
      ok: false,
      ...REFUSALS.summaryStale,
    });
    // Even when its content would be refused too: the author sees what changed first.
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "b_one" },
          content: [chip("gift_name")],
        },
      ],
    };
    expect(run({ body })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{gift_name}} before submitting.",
    });
    expect(run({ body }, { seenRev: 6 })).toEqual({
      ok: false,
      ...REFUSALS.summaryStale,
    });
  });

  it("submits the draft the summary showed", () => {
    expect(run({ rev: 12 }, { seenRev: 12 })).toMatchObject({
      ok: true,
      changes: { number: 1 },
    });
  });

  it.each([
    "in_review",
    "changes_requested",
    "active",
    "superseded",
    "revoked",
  ] as const)("refuses a %s version", (state) => {
    const result = run({ state });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(
      state === "in_review"
        ? "This version is already in review."
        : "Only a draft can be submitted.",
    );
  });

  it("names a chip in the document whose key isn't in the variable list", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        heading("b_one", "offer_details", "Offer details"),
        {
          type: "paragraph",
          attrs: { id: "b_two" },
          content: [text("Use code "), chip("promo_code")],
        },
      ],
    };
    expect(run({ body })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{promo_code}} before submitting.",
    });
  });

  it("names every missing key once, in order of first use", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "b_one" },
          content: [chip("promo_code"), chip("first_name"), chip("promo_code")],
        },
        {
          type: "paragraph",
          attrs: { id: "b_two" },
          content: [chip("gift_name")],
        },
      ],
    };
    expect(run({ body })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason:
        "Define or remove {{promo_code}} and {{gift_name}} before submitting.",
    });

    const more: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "b_one" },
          content: [chip("a_one"), chip("b_two"), chip("c_three")],
        },
      ],
    };
    expect(run({ body: more })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason:
        "Define or remove {{a_one}}, {{b_two}} and {{c_three}} before submitting.",
    });
  });

  it("finds a missing key in a table cell, a list or a callout", () => {
    const nested: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { id: "t" },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [chip("in_table")] }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(run({ body: nested })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{in_table}} before submitting.",
    });
  });

  it("checks the email subject and preheader while Email is on", () => {
    const channels = ["pdf", "web", "email"] as const;
    const subject = oneLine(text("Hi "), chip("first_name"));

    expect(
      run({
        channels: [...channels],
        channelFields: {
          email: { subject: oneLine(text("Offer "), chip("promo_code")) },
        },
      }),
    ).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{promo_code}} before submitting.",
    });
    expect(
      run({
        channels: [...channels],
        channelFields: {
          email: { subject, preheader: oneLine(chip("gift_name")) },
        },
      }),
    ).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{gift_name}} before submitting.",
    });
    expect(
      run({
        channels: [...channels],
        channelFields: {
          email: { subject, preheader: oneLine(chip("purchase_apr")) },
        },
      }).ok,
    ).toBe(true);
  });

  it("ignores the email fields while Email is off: they are not part of the output", () => {
    const result = run({
      channels: ["pdf", "web"],
      channelFields: { email: { subject: oneLine(chip("promo_code")) } },
    });
    expect(result.ok).toBe(true);
  });

  it("asks for an email subject when Email is on and the subject is empty", () => {
    const reason = "Add an email subject before submitting.";
    const email = ["pdf", "web", "email"] as const;
    expect(run({ channels: [...email], channelFields: {} })).toEqual({
      ok: false,
      code: "field_missing",
      reason,
    });
    expect(
      run({
        channels: [...email],
        channelFields: { email: { preheader: oneLine(text("Pre")) } },
      }),
    ).toEqual({ ok: false, code: "field_missing", reason });
    expect(
      run({
        channels: [...email],
        channelFields: { email: { subject: oneLine() } },
      }),
    ).toEqual({ ok: false, code: "field_missing", reason });
    expect(
      run({
        channels: [...email],
        channelFields: {
          email: { subject: { type: "doc", content: [{ type: "paragraph" }] } },
        },
      }),
    ).toEqual({
      ok: false,
      code: "field_missing",
      reason,
    });
    expect(
      run({
        channels: [...email],
        channelFields: { email: { subject: oneLine(text("   ")) } },
      }),
    ).toEqual({ ok: false, code: "field_missing", reason });
  });

  it("accepts an email subject that is only a chip, and needs no preheader", () => {
    const result = run({
      channels: ["email"],
      channelFields: { email: { subject: oneLine(chip("first_name")) } },
    });
    expect(result.ok).toBe(true);
  });

  it("doesn't need a subject when Email is off", () => {
    expect(run({ channels: ["pdf"], channelFields: {} }).ok).toBe(true);
  });

  // ── A message (an Alert): Push and SMS (decisions 0034 and 0035) ──
  describe("a message", () => {
    const ALERT: MessageTypeRules = {
      smsFooter: "Coral Offers: Reply STOP to opt out, HELP for help.",
      smsMaxParts: 3,
    };
    const lines = (...inline: JSONContent[]): JSONContent => oneLine(...inline);
    const push = {
      title: oneLine(text("Your APR changes soon")),
      body: oneLine(
        text("Hi "),
        chip("first_name"),
        text(", your purchase APR becomes "),
        chip("purchase_apr"),
        text("."),
      ),
    };
    const sms = {
      text: lines(
        text("Coral Offers: your APR becomes "),
        chip("purchase_apr"),
        text("."),
        { type: "hardBreak" },
        text("coral.example/apr"),
      ),
    };
    const alert = (
      over: Partial<SubmitDraft> = {},
      rules: MessageTypeRules = ALERT,
    ) =>
      run(
        {
          body: { type: "doc", content: [{ type: "paragraph" }] },
          channels: ["push", "sms"],
          channelFields: { push, sms },
          ...over,
        },
        { messageRules: rules },
      );

    it("submits a push and an SMS that keep every rule", () => {
      expect(alert().ok).toBe(true);
    });

    it("freezes the content type's SMS footer into the version, which every render of it prints from then on", () => {
      const result = alert();
      expect(result.ok && result.changes.smsFooter).toBe(ALERT.smsFooter);
      // A draft shows the content type's footer as it stands; a submitted version keeps its own.
      expect(smsFooterOf({ state: "draft", smsFooter: null }, "Now")).toBe(
        "Now",
      );
      expect(smsFooterOf({ state: "active", smsFooter: "Then" }, "Now")).toBe(
        "Then",
      );
      expect(
        smsFooterOf({ state: "superseded", smsFooter: null }, "Now"),
        "frozen as none",
      ).toBeNull();
    });

    it("needs every required field of each channel that is on, from the registry", () => {
      expect(
        alert({ channelFields: { push: { body: push.body }, sms } }),
      ).toEqual({
        ok: false,
        code: "field_missing",
        reason: "Add a push title before submitting.",
      });
      expect(alert({ channelFields: { push } })).toEqual({
        ok: false,
        code: "field_missing",
        reason: "Add an SMS message before submitting.",
      });
      // The subtitle is optional, and SMS's fields don't matter while SMS is off.
      expect(alert({ channels: ["push"], channelFields: { push } }).ok).toBe(
        true,
      );
    });

    it("counts a field of only invisible characters as blank: the phone shows nothing for it", () => {
      // A message's field keeps its invisible characters (an emoji's joiner), so one can hold only those.
      const invisible = oneLine(text(" ​⁠ "));
      expect(
        alert({ channelFields: { push: { ...push, title: invisible }, sms } }),
      ).toEqual({
        ok: false,
        code: "field_missing",
        reason: "Add a push title before submitting.",
      });
      expect(
        alert({
          channelFields: { push: { ...push, title: oneLine(text("❤️")) }, sms },
        }).ok,
      ).toBe(true);
    });

    it("refuses a zero-width space or a joiner the author typed in an SMS: they aren't GSM-7", () => {
      expect(
        alert({
          channelFields: { push, sms: { text: lines(text("Pay​ now")) } },
        }),
      ).toEqual({
        ok: false,
        code: "sms_characters",
        reason:
          "Replace U+200B in the SMS message before submitting. It isn't in the SMS character set.",
      });
    });

    it("refuses characters the author typed outside GSM-7, naming each once", () => {
      const typed = {
        text: lines(
          text("Your card’s APR – it’s changing. Reply"),
          chip("first_name"),
        ),
      };
      expect(alert({ channelFields: { push, sms: typed } })).toEqual({
        ok: false,
        code: "sms_characters",
        reason:
          "Replace ’, – and U+00A0 in the SMS message before submitting. They aren't in the SMS character set.",
      });
      expect(
        alert({
          channelFields: { push, sms: { text: lines(text("Façade")) } },
        }),
      ).toEqual({
        ok: false,
        code: "sms_characters",
        reason:
          "Replace ç in the SMS message before submitting. It isn't in the SMS character set.",
      });
      // Ç is GSM-7, and so is é; a value is never checked (it can switch a message to UCS-2).
      expect(
        alert({
          channelFields: {
            push,
            sms: { text: lines(text("Ç é "), chip("first_name")) },
          },
        }).ok,
      ).toBe(true);
    });

    it("refuses an SMS over the content type's parts with the long sample values, footer included", () => {
      const long = { text: lines(text("x".repeat(120)), chip("first_name")) };
      // 120 + 21 (the long first name) + a line break + the footer's 51: 193 septets, 2 parts.
      expect(alert({ channelFields: { push, sms: long } }).ok).toBe(true);
      expect(
        alert(
          { channelFields: { push, sms: long } },
          { ...ALERT, smsMaxParts: 1 },
        ),
      ).toEqual({
        ok: false,
        code: "sms_too_many_parts",
        reason:
          "With the long sample values, the SMS is 2 parts. Keep it to 1 part or fewer.",
      });
      // Without the long set, its defaults stand in.
      expect(
        alert(
          { channelFields: { push, sms: long }, sampleSets: [] },
          { ...ALERT, smsMaxParts: 1 },
        ).ok,
      ).toBe(false);
    });

    it("measures a long value that no longer validates with the generated one, so a stale set can't skip the checks", () => {
      // Edited while purchase_apr was text; it's a percent now, so the stored value isn't one any more.
      const stale = [
        {
          id: "long",
          name: "Long",
          values: { purchase_apr: "about twenty percent" },
        },
      ];
      const long = {
        text: lines(
          text("x".repeat(120)),
          chip("first_name"),
          text(" "),
          chip("purchase_apr"),
        ),
      };
      const parts = { ...ALERT, smsMaxParts: 1 };
      const refused = {
        ok: false,
        code: "sms_too_many_parts",
        reason:
          "With the long sample values, the SMS is 2 parts. Keep it to 1 part or fewer.",
      };
      expect(
        alert({ channelFields: { push, sms: long }, sampleSets: [] }, parts),
      ).toEqual(refused);
      expect(
        alert({ channelFields: { push, sms: long }, sampleSets: stale }, parts),
      ).toEqual(refused);
      // And the push size: a body over 4,096 bytes with the long values is refused whatever the stored set holds.
      const huge = oneLine(
        text("é".repeat(2040)),
        chip("purchase_apr"),
        chip("first_name"),
        chip("first_name"),
      );
      expect(
        alert({
          channels: ["push"],
          channelFields: { push: { ...push, body: huge } },
          sampleSets: stale,
        }),
      ).toMatchObject({
        ok: false,
        code: "push_too_large",
      });
    });

    it("refuses a public link shortener in an SMS or a push body", () => {
      const shortened = {
        text: lines(text("Pay at https://bit.ly/3xYz or tinyurl.com/a")),
      };
      expect(alert({ channelFields: { push, sms: shortened } })).toEqual({
        ok: false,
        code: "public_shortener",
        reason:
          "The SMS message links through bit.ly and tinyurl.com, public link shorteners carriers filter. Use a link on your own domain.",
      });
      const body = oneLine(text("See bit.ly/"), chip("first_name"));
      expect(
        alert({ channelFields: { push: { ...push, body }, sms } }),
      ).toEqual({
        ok: false,
        code: "public_shortener",
        reason:
          "The push body links through bit.ly, a public link shortener carriers filter. Use a link on your own domain.",
      });
      // A branded domain is fine; a title isn't checked.
      expect(
        alert({
          channelFields: {
            push: { ...push, title: oneLine(text("bit.ly/x")) },
            sms,
          },
        }).ok,
      ).toBe(true);
    });

    it("refuses a push over 4,096 bytes on either platform with the long sample values", () => {
      const huge = oneLine(text("é".repeat(2100)));
      expect(
        alert({ channelFields: { push: { ...push, body: huge }, sms } }),
      ).toEqual({
        ok: false,
        code: "push_too_large",
        reason:
          "With the long sample values, the push is 4,261 bytes on iPhone. It can be at most 4,096 bytes.",
      });
      // The subtitle is iPhone's alone: it can tip iPhone over while Android fits.
      const subtitle = oneLine(text("é".repeat(100)));
      const near = oneLine(text("é".repeat(1950)));
      const result = alert({
        channels: ["push"],
        channelFields: { push: { ...push, body: near, subtitle } },
      });
      expect(result).toMatchObject({ ok: false, code: "push_too_large" });
      expect(result.ok || result.reason).toContain("on iPhone");
    });

    it("refuses a draft with no channel on, which would skip every message rule", () => {
      // A crafted save could store one: the SMS here breaks every rule, and nothing would look at it.
      const typed = { text: lines(text("’ bit.ly/x ".repeat(80))) };
      expect(
        alert({ channels: [], channelFields: { push, sms: typed } }),
      ).toEqual({
        ok: false,
        code: "no_channels",
        reason: "Turn on at least one channel.",
      });
    });

    it("never runs the message rules on a document", () => {
      const typed = { text: lines(text("’")) };
      expect(
        run(
          { channels: ["pdf"], channelFields: { sms: typed } },
          { messageRules: ALERT },
        ).ok,
      ).toBe(true);
    });
  });

  it("reports an unknown key before the missing subject", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "b_one" },
          content: [chip("promo_code")],
        },
      ],
    };
    expect(run({ body, channels: ["email"], channelFields: {} })).toEqual({
      ok: false,
      code: "undefined_variables",
      reason: "Define or remove {{promo_code}} before submitting.",
    });
  });
});

// Submit and its summary find the draft the same way, and the summary's facts are what submit will freeze.
describe("draftToSubmit and submitFacts", () => {
  const row = (over: Partial<SummaryRow> & Pick<SummaryRow, "state">) => ({
    number: null,
    round: null,
    rev: 0,
    sunsetAt: null,
    name: TEMPLATE.name,
    channels: ["pdf", "web"] as const,
    variables: VARIABLES,
    sampleSets: SAMPLE_SETS,
    ...over,
  });
  const draft = row({ state: "draft", rev: 7, name: "Renamed" });
  const sentBack = row({ state: "changes_requested", number: 2, round: 1 });
  const live = row({
    state: "active",
    number: 1,
    round: 1,
    variables: VARIABLES.slice(0, 1),
  });

  it("finds the open draft, or says why there is none", () => {
    expect(draftToSubmit([live, draft])).toEqual({ ok: true, draft });
    expect(
      draftToSubmit([live, row({ state: "in_review", number: 2, round: 1 })]),
    ).toMatchObject({ ok: false, code: REFUSALS.alreadyInReview.code });
    expect(draftToSubmit([live])).toMatchObject({
      ok: false,
      code: "no_draft_to_submit",
    });
  });

  it("is the draft's rev and content, the round it would get, and the version that still renders", () => {
    expect(submitFacts([live, sentBack, draft], NOW)).toEqual({
      ok: true,
      rev: 7,
      number: 2,
      round: 2,
      name: "Renamed",
      channels: ["pdf", "web"],
      variables: VARIABLES,
      sampleSets: SAMPLE_SETS,
      baseline: {
        number: 1,
        name: TEMPLATE.name,
        variables: VARIABLES.slice(0, 1),
      },
    });
  });

  it("has no baseline when nothing renders: the Superseded version's sunset has passed at `now`", () => {
    const superseded = row({
      state: "superseded",
      number: 1,
      round: 1,
      sunsetAt: new Date(NOW.getTime() - 1),
    });
    expect(submitFacts([superseded, draft], NOW)).toMatchObject({
      ok: true,
      number: 2,
      round: 1,
      baseline: null,
    });
    expect(
      submitFacts(
        [{ ...superseded, sunsetAt: new Date(NOW.getTime() + 1) }, draft],
        NOW,
      ),
    ).toMatchObject({ baseline: { number: 1 } });
  });
});

describe("answerChangeRequests", () => {
  it("resolves each open change request as the submitter's, with an audit row about the round that asked", () => {
    const answered = answerChangeRequests(
      [
        { id: "th_1", originVersionId: "v_r1" },
        { id: "th_2", originVersionId: "v_r2" },
      ],
      { number: 1, round: 3, by: "maya", at: NOW },
    );
    expect(answered.resolve).toEqual({
      status: "resolved",
      resolvedBy: "maya",
      resolvedAt: NOW,
    });
    expect(answered.effects).toEqual(
      ["th_1", "th_2"].map((threadId, i) => ({
        kind: "audit",
        action: "thread.resolved",
        versionId: i === 0 ? "v_r1" : "v_r2",
        details: {
          threadId,
          blockId: DOCUMENT_THREAD,
          auto: true,
          resolvedWith: 1,
          resolvedWithRound: 3,
        },
      })),
    );
  });

  it("writes nothing when no change request is open", () => {
    expect(
      answerChangeRequests([], { number: 1, round: 1, by: "maya", at: NOW })
        .effects,
    ).toEqual([]);
  });
});
