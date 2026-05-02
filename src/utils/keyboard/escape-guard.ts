const ESCAPE_GUARD_SELECTOR = [
  "[data-prevent-dialog-escape='true']",
  "[role='combobox']",
  "[aria-expanded='true']",
].join(", ");

const ESCAPE_BLUR_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='textbox']",
].join(", ");

function findClosestTarget(target: EventTarget | null, selector: string) {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>(selector);
}

export function resolveEscapeGuard(...targets: Array<EventTarget | null>) {
  for (const target of targets) {
    const dismissTarget = findClosestTarget(target, ESCAPE_GUARD_SELECTOR);
    if (dismissTarget) {
      return {
        dismissTarget,
        blurTarget: null,
      };
    }
  }

  for (const target of targets) {
    const blurTarget = findClosestTarget(target, ESCAPE_BLUR_SELECTOR);
    if (blurTarget) {
      return {
        dismissTarget: null,
        blurTarget,
      };
    }
  }

  return {
    dismissTarget: null,
    blurTarget: null,
  };
}
