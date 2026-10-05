"use client";

import { createElement, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  Bell,
  BadgeCheck,
  CalendarClock,
  CirclePause,
  ClipboardCheck,
  Hourglass,
  KeyRound,
  ListChecks,
  MessageSquare,
  Moon,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AnyNotificationKind, NotificationView, NotificationsData } from "@/domain/access-types";
import { markAllNotificationsRead, markNotificationRead } from "@/server/actions/notifications";
import { NAV_ICON_STROKE } from "./nav";

/** One quiet glyph per kind. An unknown (older) kind falls back to the bell. */
const KIND_ICON: Record<AnyNotificationKind, LucideIcon> = {
  review_requested: ClipboardCheck,
  changes_requested: PencilLine,
  stage_approved: ListChecks,
  version_live: BadgeCheck,
  comment_added: MessageSquare,
  revoke_started: ShieldAlert,
  version_revoked: ShieldOff,
  sunset_scheduled: CalendarClock,
  access_requested: UserPlus,
  access_granted: UserCheck,
  access_denied: UserX,
  roles_changed: UserCog,
  access_removed: UserMinus,
  access_lapsed: Hourglass,
  access_suspended: CirclePause,
  inactivity_flagged: Moon,
  recert_due: ShieldCheck,
  team_admin_appointed: KeyRound,
};

const ICONS: Record<string, LucideIcon | undefined> = KIND_ICON;

type Change = { type: "one"; id: string } | { type: "all" };

/** The list as it will read once the server catches up: what the viewer just marked is read at once. */
function applyChange(data: NotificationsData, change: Change): NotificationsData {
  if (change.type === "all") {
    return { items: data.items.map((i) => ({ ...i, unread: false })), unreadCount: 0 };
  }
  const target = data.items.find((i) => i.id === change.id);
  if (!target?.unread) return data;
  return {
    items: data.items.map((i) => (i.id === change.id ? { ...i, unread: false } : i)),
    unreadCount: Math.max(0, data.unreadCount - 1),
  };
}

function Row({ item, onOpen }: { item: NotificationView; onOpen: (item: NotificationView) => void }) {
  const content = (
    <>
      {createElement(ICONS[item.kind] ?? Bell, {
        "aria-hidden": true,
        strokeWidth: NAV_ICON_STROKE,
        className: cn("mt-0.5 size-[18px] shrink-0", item.unread ? "text-text" : "text-text-subtle"),
      })}
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14px] leading-5", item.unread ? "font-medium text-text" : "text-text-muted")}>
          {item.title}
        </span>
        {item.body ? (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[18px] text-text-muted">{item.body}</span>
        ) : null}
        <span className="mt-1 block text-xs text-text-subtle">{item.ago}</span>
      </span>
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.unread ? "bg-brand" : "bg-transparent")}
      />
    </>
  );
  const cls = cn(
    "flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
    item.unread ? "bg-surface-tinted hover:bg-hover" : "hover:bg-hover",
  );
  return item.href ? (
    <Link
      href={item.href as Route}
      data-unread={item.unread ? "true" : undefined}
      onClick={(e) => {
        // A plain click on an unread item marks it read, then goes. Modified clicks keep their meaning.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(item);
      }}
      className={cls}
    >
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/** The viewer's notifications: a dot on the bell while any is unread; opening one marks it read and goes there. */
export function NotificationsPopover({ data }: { data: NotificationsData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const [view, change] = useOptimistic(data, applyChange);
  const unread = view.unreadCount > 0;

  function openItem(item: NotificationView) {
    setOpen(false);
    start(async () => {
      if (item.unread) {
        change({ type: "one", id: item.id });
        await markNotificationRead({ id: item.id }).catch(() => undefined);
      }
      if (item.href) router.push(item.href as Route);
    });
  }

  function markAll() {
    start(async () => {
      change({ type: "all" });
      await markAllNotificationsRead().catch(() => undefined);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={unread ? `Notifications, ${view.unreadCount} unread` : "Notifications"}
            className="relative size-9 rounded-full text-text hover:bg-hover aria-expanded:bg-hover"
          />
        }
      >
        <Bell aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
        {unread ? (
          <span
            aria-hidden
            data-slot="unread-dot"
            className="absolute top-2 right-2.5 size-2 rounded-full bg-brand ring-2 ring-canvas"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label="Notifications"
        className="w-[23rem] gap-0 rounded-2xl border border-hairline p-2 shadow-pop ring-0"
      >
        <div className="flex h-8 items-center justify-between gap-3 px-3 pt-0.5">
          <span className="text-[15px] font-medium">Notifications</span>
          {unread ? (
            <Button variant="ghost" size="sm" className="-mr-2 text-text-muted" onClick={markAll}>
              Mark all as read
            </Button>
          ) : null}
        </div>
        {view.items.length === 0 ? (
          <div className="px-3 pt-2 pb-4 text-sm text-text-muted">Nothing new</div>
        ) : (
          <ul className="mt-1 flex max-h-[26rem] flex-col gap-0.5 overflow-y-auto overscroll-contain">
            {view.items.map((item) => (
              <li key={item.id}>
                <Row item={item} onOpen={openItem} />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
