import { redirect } from "next/navigation";
import { Stream } from "@/components/primitives/stream";

async function ToLibrary({ params }: { params: Promise<{ team: string }> }): Promise<never> {
  const { team } = await params;
  redirect(`/${team}/library`);
}

export default function TeamHomePage({ params }: PageProps<"/[team]">) {
  return (
    <Stream fallback={<div className="min-h-[60vh]" />}>
      <ToLibrary params={params} />
    </Stream>
  );
}
