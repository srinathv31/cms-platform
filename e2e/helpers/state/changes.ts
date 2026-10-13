import { setClockOffsetDays } from "./clock";
import { rememberConsumerNotices } from "./consumers";
import {
  breakClockSetting,
  breakCustomerAccount,
  breakVersionBody,
} from "./faults";
import {
  createSpringTravel,
  removeSpringTravel,
  type SpringFixture,
} from "./fixtures";
import { addRole, membershipOf, rememberSignIns, removeRole } from "./people";
import {
  deleteSetting,
  rememberAllowedChannels,
  rememberSetting,
  setAllowedChannels,
  setSetting,
} from "./platform";
import { rememberSimulator, type SimulatorScope } from "./simulator";
import { addTemplateLike, rememberTemplate, removeTemplate } from "./templates";
import { rememberAuditEvents } from "./trail";
import type { TemplateRecord } from "./records";

/**
 * Everything one spec file changes in the shared data, and how to put it back. e2e's database is shared by every
 * spec file a worker runs and, against a dev server, by other people's sessions, so a spec that moves the clock,
 * revokes a version or makes a template cleans up after itself:
 *
 *   const changes = new Changes();
 *   test.beforeAll(async () => { await changes.watchTemplate(id); … });
 *   test.afterAll(() => changes.undo());
 *
 * Two kinds of method. `watch…` remembers something the *app* is about to change (a version it will revoke, the
 * clock a button will advance) so `undo` can put it back. The others make the change themselves (`setClock…`,
 * `grantRole`, `createSpringTravel`) and register how to undo it. `undo` runs the steps newest first, runs every
 * one even when an earlier one fails, and throws the first failure at the end, so call it from `afterAll`.
 */
export class Changes {
  private steps: (() => Promise<void>)[] = [];

  /** Runs `step` when `undo` is called, before the steps registered earlier. */
  onUndo(step: () => Promise<void>): void {
    this.steps.push(step);
  }

  async undo(): Promise<void> {
    const steps = this.steps.reverse();
    this.steps = [];
    const problems: unknown[] = [];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        problems.push(error);
      }
    }
    if (problems.length > 0) throw problems[0];
  }

  // ── What the app will change ──────────────────────────────────────────────

  /**
   * An existing template, as it is now: `undo` removes what was written since (a new draft, comments, audit
   * events, notifications, notices, render log rows, uploads) and puts each version back as it was.
   */
  async watchTemplate(templateId: string): Promise<void> {
    this.onUndo(await rememberTemplate(templateId));
  }

  /** A setting, as it is now (or not set). */
  async watchSetting(key: string): Promise<void> {
    this.onUndo(await rememberSetting(key));
  }

  /** The demo clock, which the Demo drawer's Advance moves. */
  watchClock(): Promise<void> {
    return this.watchSetting("clock_offset_days");
  }

  /** The channels a content type ("disclosure") allows, as they are now: Settings > Channel rules will change them. */
  async watchAllowedChannels(contentTypeKey: string): Promise<void> {
    this.onUndo(await rememberAllowedChannels(contentTypeKey));
  }

  /** The audit events with this action: `undo` removes the ones written since. */
  async watchAuditEvents(action: string): Promise<void> {
    this.onUndo(await rememberAuditEvents(action));
  }

  /** The consumer notices of this kind: `undo` removes the ones written since, and Coral's read marks on them. */
  async watchConsumerNotices(kind: string): Promise<void> {
    this.onUndo(await rememberConsumerNotices(kind));
  }

  /** When these people last signed in (a persona switch stamps it). */
  async watchSignIns(userIds: readonly string[]): Promise<void> {
    this.onUndo(await rememberSignIns(userIds));
  }

  /** Coral's links, deliveries and read marks for the offers and templates named. */
  async watchSimulator(scope: SimulatorScope): Promise<void> {
    this.onUndo(await rememberSimulator(scope));
  }

  // ── What the spec changes itself ──────────────────────────────────────────

  /**
   * A template the spec makes through the app (or the API): `undo` removes it and everything that points at it.
   * Call it as soon as the id is known; it is safe if the template never got made.
   */
  ownTemplate(templateId: string): void {
    this.onUndo(() => removeTemplate(templateId));
  }

  /** Spring Travel Rewards, live as v2 (see `createSpringTravel`); `undo` removes it. */
  async createSpringTravel(): Promise<SpringFixture> {
    // Registered first: a fixture left half made by a failure below is still removed (it carries the mark).
    this.onUndo(removeSpringTravel);
    return createSpringTravel();
  }

  /** A template that is a copy of another's row (it has no versions yet); `undo` removes it. */
  async addTemplateLike(
    sourceTemplateId: string,
    changes: Partial<TemplateRecord> & { id: string },
  ): Promise<TemplateRecord> {
    this.ownTemplate(changes.id);
    return addTemplateLike(sourceTemplateId, changes);
  }

  /** Moves the demo clock to `days` ahead of real time. */
  async setClockOffsetDays(days: number): Promise<void> {
    await this.watchClock();
    await setClockOffsetDays(days);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.watchSetting(key);
    await setSetting(key, value);
  }

  /** Removes a setting (the business zone, so it reads as its default). */
  async deleteSetting(key: string): Promise<void> {
    await this.watchSetting(key);
    await deleteSetting(key);
  }

  /** Gives a person a role on a team. Fails if they aren't a member. */
  async grantRole(userId: string, teamId: string, role: string): Promise<void> {
    const membership = await membershipOf(userId, teamId);
    if (!membership) throw new Error(`${userId} is not a member of ${teamId}.`);
    await addRole(membership.id, role);
    this.onUndo(() => removeRole(membership.id, role));
  }

  /** Changes the channels a content type ("disclosure") allows. */
  async setAllowedChannels(
    contentTypeKey: string,
    channels: readonly string[],
  ): Promise<void> {
    this.onUndo(await rememberAllowedChannels(contentTypeKey));
    await setAllowedChannels(contentTypeKey, channels);
  }

  // ── Faults (see faults.ts): each returns the function that puts the value back early ──

  async breakVersionBody(versionId: string): Promise<() => Promise<void>> {
    const restore = await breakVersionBody(versionId);
    this.onUndo(restore);
    return restore;
  }

  async breakClockSetting(): Promise<() => Promise<void>> {
    const restore = await breakClockSetting();
    this.onUndo(restore);
    return restore;
  }

  async breakCustomerAccount(): Promise<() => Promise<void>> {
    const restore = await breakCustomerAccount();
    this.onUndo(restore);
    return restore;
  }
}
