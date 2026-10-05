import { Stream } from "@/components/primitives/stream";
import {
  getAccessRequestsSection,
  getInactivitySection,
  getMembersSection,
  getRecertificationSection,
} from "@/server/queries/access";
import { demoNow } from "@/server/queries/dynamic";
import type { SectionBodyProps } from "../section-body";
import { AccessRequestsTable } from "./access-requests-table";
import { InactivityView } from "./inactivity-view";
import { MembersTable } from "./members-table";
import { RecertificationView } from "./recertification-view";
import { SectionSkeleton } from "./skeleton";

// The four Team section bodies. Each streams its own data, so the serif title is already on screen
// while the rows load. The settings panel only renders these for a viewer who manages the team.

/** The demo clock's day, YYYY-MM-DD. */
async function demoToday(): Promise<string> {
  return (await demoNow()).toISOString().slice(0, 10);
}

async function Members({ teamSlug }: SectionBodyProps) {
  return <MembersTable section={await getMembersSection(teamSlug)} />;
}

async function AccessRequests({ teamSlug }: SectionBodyProps) {
  const [section, today] = await Promise.all([getAccessRequestsSection(teamSlug), demoToday()]);
  return <AccessRequestsTable section={section} today={today} />;
}

async function Recertification({ teamSlug }: SectionBodyProps) {
  return <RecertificationView section={await getRecertificationSection(teamSlug)} />;
}

async function Inactivity({ teamSlug }: SectionBodyProps) {
  const [section, today] = await Promise.all([getInactivitySection(teamSlug), demoToday()]);
  return <InactivityView section={section} today={today} />;
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
