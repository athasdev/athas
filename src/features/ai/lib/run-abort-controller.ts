/**
 * Gives a run its own abort controller in `ref`. `release` clears the ref only while it still
 * holds this run's controller, so a stopped run that finishes late cannot clear the next one's.
 */
export function claimRunAbortController(ref: { current: AbortController | null }) {
  const controller = new AbortController();
  ref.current = controller;
  return {
    controller,
    release: () => {
      if (ref.current === controller) ref.current = null;
    },
  };
}
