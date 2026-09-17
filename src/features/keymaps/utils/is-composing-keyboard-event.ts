export function isComposingKeyboardEvent(event: Pick<KeyboardEvent, "isComposing" | "keyCode">) {
  return event.isComposing || event.keyCode === 229;
}
