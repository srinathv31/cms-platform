import { AuditView } from "@/components/audit/audit-view";

export default function AuditPage({ params, searchParams }: PageProps<"/[team]/audit">) {
  return <AuditView params={params} searchParams={searchParams} />;
}
