import { describe, expect, it } from "vitest";
import type { ChannelFields } from "../channel-fields";
import {
  addCounts,
  diffChannelFields,
  type FieldsRedline,
} from "./channel-fields";
import type { Channel, JSONContent } from "../types";
import { NO_CHANGES, inline, p, doc, type Inline } from "./fixtures";

describe("diffChannelFields", () => {
  /** A field's stored document: one paragraph, as `prepareField` makes it. */
  const field = (...parts: Inline[]): JSONContent => doc(p(null, ...parts));
  const alert = (
    channelFields: ChannelFields,
    channels: Channel[] = ["push", "sms"],
  ) => ({ channels, channelFields });
  const statuses = (result: FieldsRedline) =>
    Object.fromEntries(result.fields.map((f) => [f.field.id, f.status]));
  /** The words a field's diff marks with `op`, chips as {key}. */
  const marked = (result: FieldsRedline, id: string, op: "insert" | "delete") =>
    result.fields
      .find((f) => f.field.id === id)!
      .doc.blocks.flatMap((b) => b.node.content ?? [])
      .filter((n) =>
        n.marks?.some((m) => m.type === "redline" && m.attrs?.op === op),
      )
      .map((n) =>
        n.type === "variable" ? `{${String(n.attrs?.key)}}` : n.text,
      )
      .join("");

  it("with no base, is every field of the channels that are on, as it stands, counting nothing", () => {
    const result = diffChannelFields(
      null,
      alert({ push: { title: field("Was this you?") } }, ["push"]),
    );
    expect(result.fields.map((f) => f.field.id)).toEqual([
      "push.title",
      "push.subtitle",
      "push.body",
    ]);
    expect(Object.values(statuses(result))).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    expect(result.counts).toEqual(NO_CHANGES);
    expect(result.fields[0]!.doc.blocks[0]!.node.content).toEqual(
      inline(["Was this you?"]),
    );
  });

  it("carries the SMS footer each side prints, and counts a footer that changed while SMS stayed on", () => {
    const sms = (
      smsFooter: string | null,
      channels: Channel[] = ["push", "sms"],
    ) => ({ ...alert({ sms: { text: field("Hi") } }, channels), smsFooter });
    expect(diffChannelFields(null, sms("Reply STOP")).footer).toEqual({
      from: null,
      to: "Reply STOP",
      status: "unchanged",
    });
    expect(
      diffChannelFields(sms("Reply STOP"), sms("Reply STOP")).footer?.status,
    ).toBe("unchanged");
    const changed = diffChannelFields(
      sms("Reply STOP"),
      sms("Coral: Reply STOP"),
    );
    expect(changed.footer).toEqual({
      from: "Reply STOP",
      to: "Coral: Reply STOP",
      status: "changed",
    });
    expect(changed.counts).toEqual({ ...NO_CHANGES, changed: 1 });
    expect(diffChannelFields(sms(null), sms("Reply STOP")).footer?.status).toBe(
      "added",
    );
    expect(diffChannelFields(sms("Reply STOP"), sms(null)).footer?.status).toBe(
      "removed",
    );
    // SMS turned on: its message counts as added, and its footer comes with it, uncounted.
    const on = diffChannelFields(
      sms("Reply STOP", ["push"]),
      sms("Reply STOP"),
    );
    expect(on.footer?.status).toBe("added");
    expect(on.counts).toEqual({ ...NO_CHANGES, added: 1 });
    // No SMS on either side: no footer.
    expect(
      diffChannelFields(sms("Reply STOP", ["push"]), sms("Other", ["push"]))
        .footer,
    ).toBeNull();
  });

  it("word-diffs a changed field, an email subject among them, and counts it once", () => {
    const email = (subject: JSONContent) => ({
      channels: ["pdf", "email"] as Channel[],
      channelFields: { email: { subject } },
    });
    const result = diffChannelFields(
      email(field("Your rate is changing on {effective_date}")),
      email(field("Your rate changes soon")),
    );
    expect(statuses(result)).toEqual({
      "email.subject": "changed",
      "email.preheader": "unchanged",
    });
    expect(marked(result, "email.subject", "delete")).toBe(
      "is changing on {effective_date}",
    );
    expect(marked(result, "email.subject", "insert")).toBe("changes soon");
    expect(result.counts).toEqual({ ...NO_CHANGES, changed: 1 });
  });

  it("pairs a field however much was rewritten: a changed field, never a removal and an addition", () => {
    const result = diffChannelFields(
      alert({ sms: { text: field("Coral: one two three.") } }),
      alert({ sms: { text: field("Entirely different words here") } }),
    );
    expect(statuses(result)["sms.text"]).toBe("changed");
    expect(
      result.fields.find((f) => f.field.id === "sms.text")!.doc.blocks,
    ).toHaveLength(1);
  });

  it("is added when a field gains text, removed when it loses it, unchanged when it has none on either side", () => {
    const result = diffChannelFields(
      alert({
        push: { title: field("Hi"), subtitle: field("Card {card_last4}") },
      }),
      alert({ push: { title: field("Hi"), body: field("Pay now.") } }),
    );
    expect(statuses(result)).toEqual({
      "push.title": "unchanged",
      "push.subtitle": "removed",
      "push.body": "added",
      "sms.text": "unchanged",
    });
    expect(
      result.fields.find((f) => f.field.id === "sms.text")!.doc.blocks,
    ).toEqual([]);
    expect(result.counts).toEqual({ ...NO_CHANGES, added: 1, removed: 1 });
  });

  it("counts a field only while its channel is on: turning a channel on adds its fields, off removes them", () => {
    const fields = {
      push: { title: field("Hi") },
      sms: { text: field("Coral: hi.") },
    };
    const off = diffChannelFields(
      alert(fields, ["push", "sms"]),
      alert(fields, ["push"]),
    );
    expect(statuses(off)).toEqual({
      "push.title": "unchanged",
      "push.subtitle": "unchanged",
      "push.body": "unchanged",
      "sms.text": "removed",
    });
    const on = diffChannelFields(
      alert(fields, ["push"]),
      alert(fields, ["push", "sms"]),
    );
    expect(statuses(on)["sms.text"]).toBe("added");
  });

  it("adds two counts together", () => {
    expect(
      addCounts(
        { added: 1, removed: 0, changed: 2, moved: 1 },
        { added: 0, removed: 1, changed: 1, moved: 0 },
      ),
    ).toEqual({
      added: 1,
      removed: 1,
      changed: 3,
      moved: 1,
    });
  });
});
