type TerminalKeyboardEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey"> & {
  getModifierState?: (keyArg: string) => boolean;
};

export function isTerminalAltGraphInput(event: TerminalKeyboardEvent): boolean {
  return (
    event.getModifierState?.("AltGraph") === true ||
    (event.ctrlKey && event.altKey && !event.metaKey)
  );
}

export function isTerminalAltTextInput(event: TerminalKeyboardEvent): boolean {
  if (!event.altKey || event.metaKey) return false;
  if (event.key.length !== 1) return false;
  return !event.ctrlKey || isTerminalAltGraphInput(event);
}
