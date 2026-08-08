import type { InlineDropdownPosition } from "@/features/ai/types/chat-composer.types";

export function isComposerTokenElement(node: Node | null): node is Element {
  return (
    node?.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).hasAttribute("data-mention") ||
      (node as Element).hasAttribute("data-slash-command"))
  );
}

interface ComposerTextSegment {
  node: Node;
  text: string;
  atomic: boolean;
}

function getComposerTokenText(token: Element): string {
  if (token.hasAttribute("data-mention")) {
    const fileName = token.getAttribute("data-mention-name") || token.textContent?.trim();
    return fileName ? `@[${fileName}]` : "";
  }

  if (token.hasAttribute("data-slash-command")) {
    const commandName = token.getAttribute("data-slash-command-name") || token.textContent?.trim();
    if (!commandName) return "";
    return commandName.startsWith("/") ? commandName : `/${commandName}`;
  }

  return token.textContent || "";
}

function getComposerTextSegments(root: Node): ComposerTextSegment[] {
  const segments: ComposerTextSegment[] = [];

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      segments.push({ node, text: node.textContent || "", atomic: false });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (isComposerTokenElement(node)) {
      segments.push({ node, text: getComposerTokenText(node), atomic: true });
      return;
    }
    node.childNodes.forEach(visit);
  };

  root.childNodes.forEach(visit);
  return segments;
}

export function getComposerText(element: HTMLDivElement | null): string {
  if (!element) return "";
  return getComposerTextSegments(element)
    .map((segment) => segment.text)
    .join("");
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
  const preCaretContainer = document.createElement("div");
  preCaretContainer.appendChild(preCaretRange.cloneContents());
  return getComposerText(preCaretContainer);
}

function getNodeOffset(node: Node): number {
  const parent = node.parentNode;
  if (!parent) return 0;
  return Array.prototype.indexOf.call(parent.childNodes, node) as number;
}

function getComposerDomPoint(
  element: HTMLDivElement,
  segments: ComposerTextSegment[],
  textOffset: number,
): { node: Node; offset: number } {
  const targetOffset = Math.max(0, textOffset);
  let consumed = 0;

  for (const segment of segments) {
    const nextOffset = consumed + segment.text.length;
    if (!segment.atomic && targetOffset <= nextOffset) {
      return {
        node: segment.node,
        offset: Math.max(0, Math.min(targetOffset - consumed, segment.text.length)),
      };
    }
    if (segment.atomic && targetOffset <= nextOffset) {
      const parent = segment.node.parentNode;
      if (parent) {
        const nodeOffset = getNodeOffset(segment.node);
        return {
          node: parent,
          offset: targetOffset <= consumed ? nodeOffset : nodeOffset + 1,
        };
      }
    }
    consumed = nextOffset;
  }

  return { node: element, offset: element.childNodes.length };
}

export function getComposerTextRange(
  element: HTMLDivElement,
  startOffset: number,
  endOffset: number,
): Range {
  const segments = getComposerTextSegments(element);
  const start = getComposerDomPoint(element, segments, startOffset);
  const end = getComposerDomPoint(element, segments, Math.max(startOffset, endOffset));
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
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
