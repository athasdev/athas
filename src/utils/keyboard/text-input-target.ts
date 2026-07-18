export function isNativeTextInputElement(element: Element | null): boolean {
  if (!element) return false;

  if (typeof HTMLTextAreaElement !== "undefined" && element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (typeof HTMLInputElement !== "undefined" && element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }

  return (
    typeof HTMLElement !== "undefined" &&
    element instanceof HTMLElement &&
    element.isContentEditable
  );
}

export function isNativeTextInputTarget(
  target: EventTarget | null,
  activeElement: Element | null = typeof document === "undefined" ? null : document.activeElement,
): boolean {
  const targetElement = target instanceof Element ? target : null;

  return isNativeTextInputElement(targetElement) || isNativeTextInputElement(activeElement);
}
