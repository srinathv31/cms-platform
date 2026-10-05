import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * Initials on a soft tint. The tint is derived from the user's stored hue, so it is data,
 * not a hard-coded palette: one lightness/chroma pair, hue per person.
 */
export function UserAvatar({
  initials,
  hue,
  size = "default",
  muted = false,
  className,
}: {
  initials: string;
  hue: number;
  size?: "default" | "sm" | "lg";
  /**
   * A dimmed row (suspended, lapsed, decided): the tint goes almost grey instead of fading the avatar,
   * so the initials keep ≥ 4.5:1 (about 5.7:1).
   */
  muted?: boolean;
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback
        className={cn("font-medium", size === "sm" ? "text-[10px]" : "text-[12px]")}
        style={{
          backgroundColor: muted ? `oklch(0.94 0.008 ${hue})` : `oklch(0.925 0.04 ${hue})`,
          color: muted ? `oklch(0.45 0.015 ${hue})` : `oklch(0.38 0.07 ${hue})`,
        }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
