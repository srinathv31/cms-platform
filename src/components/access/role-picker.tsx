"use client";

import { SegmentedRadio } from "@/components/primitives/segmented";
import { ROLE_LABEL } from "@/domain/access";
import type { RequestableRole } from "@/domain/access-types";

/** Viewer, Author or Approver: the app's segmented control, as a radio group. There is always one chosen. */
export function RolePicker({
  roles,
  value,
  onChange,
  labelledBy,
  className,
}: {
  roles: readonly RequestableRole[];
  value: RequestableRole;
  onChange: (role: RequestableRole) => void;
  labelledBy: string;
  className?: string;
}) {
  return (
    <SegmentedRadio
      labelledBy={labelledBy}
      value={value}
      options={roles.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
      onChange={onChange}
      className={className}
    />
  );
}
