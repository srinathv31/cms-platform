// Motion vocabulary — mirrors the --dur-* / --ease-* tokens in tokens.css.
// Calm and fast: nothing staggers, nothing counts up, nothing loops except the SHARE ring on hover.

export const ease = {
  outSoft: [0.22, 1, 0.36, 1] as const,
};

export const duration = {
  fast: 0.12,
  base: 0.18,
  slow: 0.32,
};

export const spring = {
  /** Default for layout moves (active nav pill, tab underline). */
  soft: { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const,
  /** Chip insert pop, small confirmations. */
  pop: { type: "spring", stiffness: 640, damping: 30, mass: 0.8 } as const,
};

export const fadeRise = {
  initial: { opacity: 0, y: 2 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: duration.base, ease: ease.outSoft },
};
