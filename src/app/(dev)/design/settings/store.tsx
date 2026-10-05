"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  COHORT,
  INACTIVE_SUSPEND_DAYS,
  INITIAL_STAGES,
  RECERT_CONFIRMED,
  RECERT_DEADLINE,
  REQUESTS,
  TEAMS,
  type ChannelName,
  type MemberRow,
  type Role,
  type Stage,
  type TeamRow,
} from "./data";

/* All state lives here, in memory: nothing persists, nothing hits a server. */

export type AccessState =
  | { kind: "active" }
  | { kind: "suspended"; day: number; auto: boolean }
  | { kind: "lapsed"; day: number }
  | { kind: "removed" };

interface State {
  clock: number;
  roles: Record<string, Role>;
  suspended: Record<string, number>;
  removed: Record<string, true>;
  reqs: Record<string, { decision: "approved" | "declined"; note?: string; day: number }>;
  recert: Record<string, "keep" | "remove">;
  kept: Record<string, number>;
  stages: Stage[];
  teams: TeamRow[];
  channels: Record<string, boolean>;
}

const initial = (): State => ({
  clock: 0,
  roles: {},
  suspended: {},
  removed: {},
  reqs: {},
  recert: Object.fromEntries(Object.keys(RECERT_CONFIRMED).map((id) => [id, "keep" as const])),
  kept: {},
  stages: INITIAL_STAGES,
  teams: TEAMS,
  channels: Object.fromEntries(["PDF", "Web", "Email"].map((c) => [`disclosure:${c}`, true])),
});

export interface Store extends State {
  members: MemberRow[];
  roleOf: (id: string) => Role;
  access: (id: string) => AccessState;
  idleDays: (id: string) => number;
  autoSuspendDay: (id: string) => number;
  recertState: (id: string) => "confirmed" | "pending" | "removed" | "lapsed";
  setClock: (days: number) => void;
  reset: () => void;
  setRole: (id: string, role: Role) => void;
  suspend: (id: string) => void;
  reactivate: (id: string) => void;
  remove: (id: string) => void;
  decide: (id: string, who: string, decision: "approved" | "declined", role: Role, note?: string) => void;
  decideRecert: (id: string, d: "keep" | "remove") => void;
  keep: (id: string) => void;
  addStage: (stage: Stage) => void;
  removeStage: (id: string) => void;
  addTeam: (team: TeamRow) => void;
  setChannel: (key: string, on: boolean) => void;
  channelOn: (type: string, ch: ChannelName) => boolean;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

export function StoreProvider({ children, initialClock = 0 }: { children: React.ReactNode; initialClock?: number }) {
  const [s, setS] = useState<State>(() => ({ ...initial(), clock: initialClock }));
  const patch = useCallback((fn: (p: State) => Partial<State>) => setS((p) => ({ ...p, ...fn(p) })), []);

  const store = useMemo<Store>(() => {
    const approvedExtra: MemberRow[] = REQUESTS.filter((r) => s.reqs[r.id]?.decision === "approved").map((r) => ({
      id: r.who,
      role: s.roles[r.who] ?? r.role,
      lastActive: s.reqs[r.id]!.day,
      added: s.reqs[r.id]!.day,
      drafts: 0,
    }));
    const members = [...COHORT, ...approvedExtra].filter((m) => !s.removed[m.id]);
    const roleOf = (id: string) => s.roles[id] ?? [...COHORT, ...approvedExtra].find((m) => m.id === id)?.role ?? "Viewer";
    const lastSeen = (id: string) => Math.max(members.find((m) => m.id === id)?.lastActive ?? 0, s.kept[id] ?? -9999);
    const idleDays = (id: string) => {
      const m = members.find((x) => x.id === id);
      // Everyone but the seeded inactive member is assumed to keep logging in.
      if (!m || m.lastActive > -60) return 0;
      return s.clock - lastSeen(id);
    };
    const autoSuspendDay = (id: string) => lastSeen(id) + INACTIVE_SUSPEND_DAYS;
    const recertState: Store["recertState"] = (id) => {
      const d = s.recert[id];
      if (d === "keep") return "confirmed";
      if (d === "remove") return "removed";
      return s.clock > RECERT_DEADLINE ? "lapsed" : "pending";
    };
    const access: Store["access"] = (id) => {
      if (s.removed[id]) return { kind: "removed" };
      if (id in s.suspended) return { kind: "suspended", day: s.suspended[id]!, auto: false };
      if (recertState(id) === "lapsed") return { kind: "lapsed", day: RECERT_DEADLINE };
      if (idleDays(id) >= INACTIVE_SUSPEND_DAYS) return { kind: "suspended", day: autoSuspendDay(id), auto: true };
      return { kind: "active" };
    };
    return {
      ...s,
      members,
      roleOf,
      access,
      idleDays,
      autoSuspendDay,
      recertState,
      setClock: (days) => patch(() => ({ clock: days })),
      reset: () => setS(initial()),
      setRole: (id, role) => patch((p) => ({ roles: { ...p.roles, [id]: role } })),
      suspend: (id) => patch((p) => ({ suspended: { ...p.suspended, [id]: p.clock } })),
      reactivate: (id) =>
        patch((p) => {
          const { [id]: _gone, ...suspended } = p.suspended;
          void _gone;
          return { suspended, kept: { ...p.kept, [id]: p.clock }, recert: { ...p.recert, [id]: "keep" } };
        }),
      remove: (id) => patch((p) => ({ removed: { ...p.removed, [id]: true } })),
      decide: (id, who, decision, role, note) =>
        patch((p) => ({
          reqs: { ...p.reqs, [id]: { decision, note, day: p.clock } },
          roles: decision === "approved" ? { ...p.roles, [who]: role } : p.roles,
        })),
      decideRecert: (id, d) => patch((p) => ({ recert: { ...p.recert, [id]: d } })),
      keep: (id) => patch((p) => ({ kept: { ...p.kept, [id]: p.clock } })),
      addStage: (stage) => patch((p) => ({ stages: [...p.stages, stage] })),
      removeStage: (id) => patch((p) => ({ stages: p.stages.filter((x) => x.id !== id) })),
      addTeam: (team) => patch((p) => ({ teams: [...p.teams, team] })),
      setChannel: (key, on) => patch((p) => ({ channels: { ...p.channels, [key]: on } })),
      channelOn: (type, ch) => s.channels[`${type}:${ch}`] ?? false,
    };
  }, [s, patch]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
