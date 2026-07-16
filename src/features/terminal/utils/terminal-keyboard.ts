type TerminalKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey" | "type"
> & {
  getModifierState?: (keyArg: string) => boolean;
};

export type TerminalKeyAction =
  | { type: "passthrough" }
  | { type: "block" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "switchTab"; direction: "next" | "prev" }
  | { type: "write"; data: string };

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

export function getTerminalKeyAction(
  event: TerminalKeyboardEvent,
  platform = "macos",
): TerminalKeyAction {
  if (event.type !== "keydown") return { type: "passthrough" };

  if (platform !== "macos" && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "c") return { type: "copy" };
    if (key === "v") return { type: "paste" };
  }

  if (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "PageUp" || event.key === "PageDown")
  ) {
    return {
      type: "switchTab",
      direction: event.key === "PageDown" ? "next" : "prev",
    };
  }

  if (event.key === "Enter" && !event.metaKey) {
    const modifier =
      1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
    if (modifier > 1) {
      return { type: "write", data: `\x1b[13;${modifier}u` };
    }
  }

  if (isTerminalAltTextInput(event)) return { type: "passthrough" };

  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    const metaSequences: Record<string, string> = {
      Backspace: "\u0015",
      k: "\u000c",
      a: "\u0001",
      e: "\u0005",
      ArrowLeft: "\u0001",
      ArrowRight: "\u0005",
    };
    const data = metaSequences[event.key];
    return data ? { type: "write", data } : { type: "block" };
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const altSequences: Record<string, string> = {
      Backspace: "\u0017",
      ArrowLeft: "\u001bb",
      ArrowRight: "\u001bf",
    };
    const data = altSequences[event.key];
    if (data) return { type: "write", data };
  }

  return event.metaKey ? { type: "block" } : { type: "passthrough" };
}
