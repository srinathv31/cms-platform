import { pt } from "./geometry";
import type { AppMark as AppMarkData } from "./types";

/**
 * The sending app's icon: its monogram in the display face on a tile in the brand's tone. Never a real
 * app's icon. `corner` is the radius as a share of the size (an iOS tile is about 0.2237). With a `label`
 * it is an image named for the app (read before the notification's title); without one it is decoration.
 */
export function AppMark({
  mark,
  size,
  corner,
  label,
}: {
  mark: AppMarkData;
  size: number;
  corner: number;
  label?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-slot="app-mark"
      style={{
        width: pt(size),
        height: pt(size),
        borderRadius: pt(size * corner),
        fontSize: pt(size * 0.58),
        boxShadow: `inset 0 0 0 ${pt(0.5)} var(--device-glass-rim)`,
      }}
      className="grid shrink-0 place-items-center bg-linear-to-b from-(--device-mark-from) to-(--device-mark-to) font-display leading-none text-(--device-mark-ink)"
    >
      <span aria-hidden style={{ marginTop: pt(-size * 0.04) }}>
        {mark.monogram}
      </span>
    </span>
  );
}
