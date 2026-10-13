import { Stream } from "@/components/primitives/stream";
import {
  getAccessRequestsSection,
  getInactivitySection,
  getMembersSection,
  getRecertificationSection,
} from "@/server/queries/access";
import type { SectionBodyProps } from "../section-body";
import { AccessRequestsTable } from "./access-requests-table";
import { InactivityView } from "./inactivity-view";
import { MembersTable } from "./members-table";
import { RecertificationView } from "./recertification-view";
import { SectionSkeleton } from "./skeleton";

// The four Team section bodies. Each streams its own data, so the serif title is already on screen
// while the rows load. The settings panel only renders these for a viewer who manages the team.

async function Members({ teamSlug }: SectionBodyProps) {
  return <MembersTable section={await getMembersSection(teamSlug)} />;
}

async function AccessRequests({ teamSlug }: SectionBodyProps) {
  const section = await getAccessRequestsSection(teamSlug);
  return <AccessRequestsTable section={section} today={section.today} />;
}

async function Recertification({ teamSlug }: SectionBodyProps) {
  return (
    <RecertificationView section={await getRecertificationSection(teamSlug)} />
  );
}

async function Inactivity({ teamSlug }: SectionBodyProps) {
  const section = await getInactivitySection(teamSlug);
  return <InactivityView section={section} today={section.today} />;
}

function streamed(Body: (props: SectionBodyProps) => Promise<React.ReactNode>) {
  return function StreamedBody(props: SectionBodyProps) {
    return (
      <Stream fallback={<SectionSkeleton />}>
        <Body {...props} />
      </Stream>
    );
  };
}

export const MembersBody = streamed(Members);
export const AccessRequestsBody = streamed(AccessRequests);
export const RecertificationBody = streamed(Recertification);
export const InactivityBody = streamed(Inactivity);
