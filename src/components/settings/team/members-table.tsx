"use client";

import { useState } from "react";
import { ROLE_LABEL, describeRoleChange, rolesLabel, sortRoles } from "@/domain/access";
import type { MemberRow, MembersSection } from "@/domain/access-types";
import type { TeamRole } from "@/domain/types";
import { Checkbox } from "@/components/ui/checkbox";
import { changeMemberRoles, reinstateMember, removeMember } from "@/server/actions/access";
import { fmtDay, daysAgo, firstName } from "./format";
import { RowTable, Strip, type RowAct, type RowData } from "./rows";

/** Why a member is not active, in the dimmed row's sub line. */
function stateNote(m: MemberRow, today: string): string {
  const at = m.statusChangedAt ? ` ${fmtDay(m.statusChangedAt, today)}` : "";
  if (m.status === "lapsed") return `Access lapsed${at}`;
  return `${m.statusReason === "inactivity_auto" ? "Auto-suspended" : "Suspended"}${at}`;
}

function RolesEditor({
  m,
  team,
  roles,
  close,
}: {
  m: MemberRow;
  team: MembersSection["team"];
  roles: readonly TeamRole[];
  close: () => void;
}) {
  const [picked, setPicked] = useState<TeamRole[]>(sortRoles(m.roles));
  const next = sortRoles(picked);
  // The domain words the line and says when there's nothing to save, as the roles are ticked.
  const change = describeRoleChange({ member: m.person, team, from: m.roles, to: next });
  return (
    <Strip
      consequence={change.line}
      confirmLabel="Save roles"
      blocked={change.blocked}
      onConfirm={() => changeMemberRoles({ membershipId: m.membershipId, roles: next })}
      onCancel={close}
      onDone={close}
    >
      <div role="group" aria-label={`Roles for ${m.person.name}`} className="flex flex-wrap gap-x-5 gap-y-2">
        {roles.map((role, i) => (
          <label key={role} className="flex cursor-pointer items-center gap-2 text-[14px] text-text">
            <Checkbox
              data-autofocus={i === 0 ? "" : undefined}
              checked={picked.includes(role)}
              onCheckedChange={(on) => setPicked((p) => (on ? [...p, role] : p.filter((r) => r !== role)))}
            />
            {ROLE_LABEL[role]}
          </label>
        ))}
      </div>
    </Strip>
  );
}

export function MembersTable({ section }: { section: MembersSection }) {
  const { team, today } = section;
  const reason = (r: { ok: true } | { ok: false; reason: string }) => (r.ok ? null : r.reason);

  const rows: RowData[] = section.rows.map((m) => {
    const first = firstName(m.person.name);
    const active = m.status === "active";
    const actions: RowAct[] = [
      active
        ? {
            key: "roles",
            label: "Edit roles",
            blocked: reason(m.can.editRoles),
            custom: ({ close }) => <RolesEditor m={m} team={team} roles={section.roles} close={close} />,
          }
        : {
            key: "restore",
            label: "Restore",
            blocked: reason(m.can.reinstate),
            strip: {
              consequence: m.consequences.reinstate,
              confirmLabel: `Restore ${first}`,
              run: () => reinstateMember({ membershipId: m.membershipId }),
            },
          },
      {
        key: "remove",
        label: "Remove",
        blocked: reason(m.can.remove),
        strip: {
          consequence: m.consequences.remove,
          confirmLabel: `Remove ${first}`,
          run: () => removeMember({ membershipId: m.membershipId }),
        },
      },
    ];
    return {
      id: m.membershipId,
      person: m.person,
      aside: m.isYou ? "You" : undefined,
      sub: active ? m.title : stateNote(m, today),
      dim: !active,
      cells: [rolesLabel(m.roles), daysAgo(m.lastActiveAt, today)],
      actions,
    };
  });

  return <RowTable label="Member" columns={["Role", "Last active"]} cols="10.5rem 6.5rem" rows={rows} empty="No members." />;
}
