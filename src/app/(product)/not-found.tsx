import Link from "next/link";
import { PageHeader } from "@/components/primitives/page-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageHeader
      title="Not found"
      action={
        <Button variant="outline" size="lg" className="rounded-full bg-surface px-4" nativeButton={false} render={<Link href="/" />}>
          Back to library
        </Button>
      }
    />
  );
}
