import type { InlineDropdownPosition } from "@/features/ai/types/chat-composer.types";

export function isComposerTokenElement(node: Node | null): node is Element {
  return (
    node?.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).hasAttribute("data-mention") ||
      (node as Element).hasAttribute("data-slash-command"))
  );
}

export function getComposerText(element: HTMLDivElement | null): string {
  if (!element) return "";

  const { childNodes } = element;
  let hasComposerTokens = false;
  for (let index = 0; index < childNodes.length; index++) {
    if (isComposerTokenElement(childNodes[index])) {
      hasComposerTokens = true;
      break;
    }
  }

  if (!hasComposerTokens) {
    return element.textContent || "";
  }

  let text = "";
  for (let index = 0; index < childNodes.length; index++) {
    const node = childNodes[index];
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const token = node as Element;
    if (token.hasAttribute("data-mention")) {
      const fileName = token.getAttribute("data-mention-name") || token.textContent?.trim();
      if (fileName) text += `@[${fileName}]`;
    } else if (token.hasAttribute("data-slash-command")) {
      const commandName =
        token.getAttribute("data-slash-command-name") || token.textContent?.trim();
      if (commandName) text += commandName.startsWith("/") ? commandName : `/${commandName}`;
    } else {
      text += node.textContent || "";
    }
  }

  return text;
}

export function getComposerTextBeforeCaret(element: HTMLDivElement | null): string {
  if (!element) return "";

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return getComposerText(element);

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return getComposerText(element);

  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  return preCaretRange.toString();
}

export function getComposerDropdownPosition(
  element: HTMLDivElement | null,
): InlineDropdownPosition {
  if (!element) {
    return { top: 0, bottom: 0, left: 0, width: 0 };
  }

  const inputRect = element.getBoundingClientRect();
  if (inputRect.width <= 0 || inputRect.height <= 0 || inputRect.bottom <= 0) {
    return { top: 0, bottom: 0, left: 0, width: 0 };
  }

  const fallbackPosition: InlineDropdownPosition = {
    top: Math.max(inputRect.top, inputRect.bottom - 24),
    bottom: inputRect.bottom,
    left: inputRect.left + 12,
    width: 320,
  };
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return fallbackPosition;

  const range = selection.getRangeAt(0).cloneRange();
  if (!element.contains(range.startContainer)) return fallbackPosition;

  range.collapse(true);
  let rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if ((rect.width === 0 && rect.height === 0) || !Number.isFinite(rect.left)) {
    const marker = document.createElement("span");
    marker.textContent = "\u200B";
    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    const parent = marker.parentNode;
    const nextSibling = marker.nextSibling;
    marker.remove();

    if (parent) {
      const restoreRange = document.createRange();
      if (nextSibling) {
        restoreRange.setStartBefore(nextSibling);
      } else {
        restoreRange.selectNodeContents(parent);
        restoreRange.collapse(false);
      }
      restoreRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(restoreRange);
    }
  }

  if (!Number.isFinite(rect.left) || rect.height === 0) return fallbackPosition;

  const horizontalPadding = 12;
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: Math.min(
      Math.max(rect.left, inputRect.left + horizontalPadding),
      inputRect.right - horizontalPadding,
    ),
    width: 320,
  };
}
