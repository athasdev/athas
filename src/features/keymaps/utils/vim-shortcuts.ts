type VimKeyboardEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const VIM_CONTROL_KEYS = new Set(["b", "r", "t", "w"]);

export function isVimOwnedShortcut(event: VimKeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    VIM_CONTROL_KEYS.has(event.key.toLowerCase())
  );
}
