import * as React from "react"

// Stencil edit to this generated file: 800, not shadcn's 768. It is the width below which the app shell turns the
// sidebar into a drawer (decision 0045). globals.css has the same number in its `narrow:` variant.
export const MOBILE_BREAKPOINT = 800
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
