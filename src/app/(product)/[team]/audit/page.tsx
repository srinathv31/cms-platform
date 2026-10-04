import { PagePlaceholder } from "@/components/app-shell/page-placeholder";

export default function AuditPage({ params }: PageProps<"/[team]/audit">) {
  return <PagePlaceholder title="Audit" params={params} requireAudit />;
}
