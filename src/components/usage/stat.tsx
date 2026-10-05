import { InfoDot } from "./panel";

// The pieces of a stat card: the big numeral (with a trend pill beside it), its tracked-caps label and
// the plain lines under a hairline.

export function Numeral({ value, trend }: { value: string; trend?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="numeral text-text">{value}</div>
      {trend}
    </div>
  );
}

export function StatLabel({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <div className="caps-label mt-3">
      {children} {tip ? <InfoDot tip={tip} /> : null}
    </div>
  );
}

export function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-5 border-t border-hairline-strong pt-4">
      {rows.map(([a, b]) => (
        <div key={a} className="flex items-center justify-between gap-3 py-1.5 text-[16px] text-text">
          <span>{a}</span>
          <span className="text-text-muted">{b}</span>
        </div>
      ))}
    </div>
  );
}
