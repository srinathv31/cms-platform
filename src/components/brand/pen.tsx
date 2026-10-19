import type { StencilLogoSize } from "./sketch";

export type PenTool = "nib" | "pencil";

/**
 * The tool at the end of a pen line, drawn with its tip at (x, y) and its body leaning `angle` degrees clockwise
 * from straight up. At `nav` it is a silhouette (detail that small smudges); at `hero` it has its slit and breather
 * hole, or the pencil's cone and ferrule. Units, inside a layer whose viewBox is in units.
 */
export function Pen({
  tool,
  size,
  x,
  y,
  angle,
  scale = 1,
}: {
  tool: PenTool;
  size: StencilLogoSize;
  x: number;
  y: number;
  angle: number;
  scale?: number;
}) {
  const Tool =
    tool === "pencil"
      ? size === "nav"
        ? NavPencil
        : HeroPencil
      : size === "nav"
        ? NavNib
        : HeroNib;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <Tool />
    </g>
  );
}

// Each tool is drawn with its tip at the origin, pointing down, its body going up the y axis.

function NavNib() {
  return (
    <path
      d="M0 0C.9-1.9 2.3-3.5 2.3-5.2V-8H-2.3V-5.2C-2.3-3.5-.9-1.9 0 0Z"
      className="fill-logo-ink"
      stroke="none"
    />
  );
}

function HeroNib() {
  return (
    <g className="stroke-logo-ink">
      <path
        d="M0 0C1.3-2.7 3.1-4.7 3.1-6.8V-9.4H-3.1V-6.8C-3.1-4.7-1.3-2.7 0 0Z"
        className="fill-logo-paper"
      />
      <path d="M0-1V-4.7" />
      <circle cx="0" cy="-5.6" r=".8" className="fill-logo-ink" />
      <rect
        x="-3.7"
        y="-12.6"
        width="7.4"
        height="3.2"
        rx=".7"
        className="fill-logo-accent"
      />
    </g>
  );
}

function NavPencil() {
  return (
    <g stroke="none">
      <path d="M0 0L2-4.4H-2Z" className="fill-logo-ink" />
      <path d="M-2-5.4H2V-12.4H-2Z" className="fill-logo-ink" />
    </g>
  );
}

function HeroPencil() {
  return (
    <g className="stroke-logo-ink">
      <path d="M0 0L2.6-5.8H-2.6Z" className="fill-logo-paper" />
      <path d="M0 0L.95-2.1H-.95Z" className="fill-logo-ink" />
      <path d="M-2.6-5.8H2.6V-16.4H-2.6Z" className="fill-logo-accent" />
      <path d="M0-5.8V-16.4" />
      <path d="M-2.6-16.4H2.6V-18.6H-2.6Z" className="fill-logo-paper" />
      <path
        d="M-2.6-18.6H2.6V-19.9C2.6-20.9 1.9-21.4 1-21.4H-1C-1.9-21.4-2.6-20.9-2.6-19.9Z"
        className="fill-logo-wash"
      />
    </g>
  );
}
