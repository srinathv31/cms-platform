import { LibraryView } from "@/components/library/library-view";

export default function LibraryPage({ params }: PageProps<"/[team]/library">) {
  return <LibraryView params={params} />;
}
