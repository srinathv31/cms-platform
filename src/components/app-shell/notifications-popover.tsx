"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NotificationItem } from "@/server/queries/notifications";
import { NAV_ICON_STROKE } from "./nav";

function Row({ item, onNavigate }: { item: NotificationItem; onNavigate: () => void }) {
  const content = (
    <>
      <span
        aria-hidden
        className={cn("mt-[7px] size-2 shrink-0 rounded-full", item.unread ? "bg-brand" : "bg-transparent")}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[14px] leading-5", item.unread ? "font-medium" : "font-normal")}>
          {item.title}
        </span>
        {item.body ? (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[18px] text-text-muted">
            {item.body}
          </span>
        ) : null}
        <span className="mt-1 block text-xs text-text-subtle">{item.ago}</span>
      </span>
    </>
  );
  const cls = "flex items-start gap-3 rounded-xl px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return item.href ? (
    <Link href={item.href as Route} onClick={onNavigate} className={cn(cls, "hover:bg-hover")}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/** The viewer's notifications. Read-only in Phase 1. */
export function NotificationsPopover({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const unread = items.some((i) => i.unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={unread ? "Notifications, unread" : "Notifications"}
            className="relative size-9 rounded-full text-text hover:bg-hover aria-expanded:bg-hover"
          />
        }
      >
        <Bell aria-hidden strokeWidth={NAV_ICON_STROKE} className="size-5" />
        {unread ? (
          <span aria-hidden className="absolute top-2 right-2.5 size-2 rounded-full bg-brand ring-2 ring-canvas" />
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label="Notifications"
        className="w-[23rem] gap-0 rounded-2xl border border-hairline p-2 shadow-pop ring-0"
      >
        <div className="px-3 pt-2 pb-2 text-[15px] font-medium">Notifications</div>
        {items.length === 0 ? (
          <div className="px-3 pt-1 pb-4 text-sm text-text-muted">Nothing new</div>
        ) : (
          <ul className="max-h-[24rem] overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <Row item={item} onNavigate={() => setOpen(false)} />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
