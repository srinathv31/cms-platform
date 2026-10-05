import { getSimHome } from "@/simulator/queries";

/** The unread count beside "Notices" in the sidebar. Streams: it reads Coral's notice inbox. */
export async function NoticeBadge() {
  const { unread } = await getSimHome();
  if (unread === 0) return null;
  return (
    <span
      aria-label={`${unread} unread`}
      className="grid h-4 min-w-4 place-items-center rounded-full bg-(--sim-accent) px-1 text-[10px] font-semibold text-(--sim-accent-text)"
    >
      {unread}
    </span>
  );
}
