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
  className,
}: {
  initials: string;
  hue: number;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback
        className={cn("font-medium", size === "sm" ? "text-[10px]" : "text-[12px]")}
        style={{
          backgroundColor: `oklch(0.925 0.04 ${hue})`,
          color: `oklch(0.38 0.07 ${hue})`,
        }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
