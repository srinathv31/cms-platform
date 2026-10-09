// The controls that code sends focus to: after an Esc puts the preview away, after a submit, after a revert.
// The header (in the layout) and the Content page are separate React subtrees, so a caller in one can't hold a
// ref to a control in the other. Each control registers itself here while it is mounted (`useFocusTarget` in
// workspace-session.tsx), and callers ask for it by what it is, never through the DOM: renaming a label or
// moving a control can't change where focus goes (decision 0027).
//
// Plain TypeScript, no React. The workspace session carries one (`session.focusTargets`).

/** The controls, by name, and the element each one is. */
export interface FocusTargetElements {
  /** The template name field in the header (name-field.tsx). */
  name: HTMLTextAreaElement;
  /** The header's status row (status-row.tsx), registered with the version state it shows. */
  statusRow: HTMLElement;
  /** The tab bar's Preview toggle (`PreviewToggle` in workspace-actions.tsx). */
  previewToggle: HTMLElement;
  /**
   * An imported template's Original tab, in the rail's header row: the plain rail's, or the widened rail's while
   * the preview is open. Only one of the two rows is mounted at a time.
   */
  originalTab: HTMLElement;
}

export type FocusTargetName = keyof FocusTargetElements;

export interface WaitForFocusTarget<N extends FocusTargetName> {
  /** Whether this is the one to wait for. `state` is what it registered with. Without it, any one will do. */
  accept?: (element: FocusTargetElements[N], state: string | undefined) => boolean;
  /** How long to wait, in milliseconds, before giving up. */
  timeout: number;
}

export interface FocusTargets {
  /**
   * Registers the control `name` stands for, until the returned function is called. `state` is what it shows,
   * for a caller waiting for a particular one (the status row: the version's state). A later registration under
   * the same name replaces it, and taking out one that was replaced does nothing.
   */
  register: <N extends FocusTargetName>(name: N, element: FocusTargetElements[N], state?: string) => () => void;
  /** The control registered under `name`, or null while none is mounted. */
  get: <N extends FocusTargetName>(name: N) => FocusTargetElements[N] | null;
  /**
   * Resolves with the control registered under `name` once `accept` takes it: at once when the one registered now
   * does, otherwise when one that does registers. Resolves with null when none has by `timeout`.
   */
  waitFor: <N extends FocusTargetName>(name: N, options: WaitForFocusTarget<N>) => Promise<FocusTargetElements[N] | null>;
}

interface Entry {
  element: HTMLElement;
  state: string | undefined;
}

interface Waiter {
  name: FocusTargetName;
  accept: (element: HTMLElement, state: string | undefined) => boolean;
  settle: (element: HTMLElement | null) => void;
}

const anyOne = () => true;

export function createFocusTargets(): FocusTargets {
  const entries = new Map<FocusTargetName, Entry>();
  const waiters = new Set<Waiter>();

  return {
    register(name, element, state) {
      const entry: Entry = { element, state };
      entries.set(name, entry);
      for (const waiter of [...waiters]) {
        if (waiter.name === name && waiter.accept(element, state)) waiter.settle(element);
      }
      return () => {
        if (entries.get(name) === entry) entries.delete(name);
      };
    },

    get<N extends FocusTargetName>(name: N) {
      return (entries.get(name)?.element ?? null) as FocusTargetElements[N] | null;
    },

    waitFor<N extends FocusTargetName>(name: N, { accept = anyOne, timeout }: WaitForFocusTarget<N>) {
      const test = accept as Waiter["accept"];
      const now = entries.get(name);
      if (now && test(now.element, now.state)) return Promise.resolve(now.element as FocusTargetElements[N]);
      return new Promise<FocusTargetElements[N] | null>((resolve) => {
        const waiter: Waiter = {
          name,
          accept: test,
          settle: (element) => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolve(element as FocusTargetElements[N] | null);
          },
        };
        const timer = setTimeout(() => waiter.settle(null), timeout);
        waiters.add(waiter);
      });
    },
  };
}
