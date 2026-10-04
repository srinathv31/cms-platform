import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** Flow-style keycap chip (⌥ Opt, ⌘, K). Hairline border on a sunken fill. */
export function Keycap({ className, ...props }: React.ComponentProps<typeof Kbd>) {
  return (
    <Kbd
      className={cn(
        "h-5 min-w-5 rounded-md border border-hairline bg-surface-sunken px-1.5 font-sans text-[11px] font-medium text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Renders a shortcut like ["⌘", "K"] as keycaps. */
export function Shortcut({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <KbdGroup className={className}>
      {keys.map((k) => (
        <Keycap key={k}>{k}</Keycap>
      ))}
    </KbdGroup>
  );
}
