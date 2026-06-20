import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";

function setStyleProperty(
  element: HTMLElement,
  property: "left" | "maxWidth" | "width",
  value: string,
) {
  if (element.style[property] === value) return;
  element.style[property] = value;
}

export function syncMonacoHoverBounds(container: HTMLElement) {
  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const maxWidth = Math.max(120, container.clientWidth - margin * 2);
  container.style.setProperty("--athas-monaco-hover-max-width", `${maxWidth}px`);
}

export function clampMonacoHoverWidgets(container: HTMLElement) {
  syncMonacoHoverBounds(container);

  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const maxWidth = Math.max(120, container.clientWidth - margin * 2);
  const widgetNodes = container.querySelectorAll<HTMLElement>(
    '[widgetid="editor.contrib.resizableContentHoverWidget"], [widgetid="editor.contrib.modesGlyphHoverWidget"]',
  );

  for (const widgetNode of widgetNodes) {
    const hoverNode = widgetNode.querySelector<HTMLElement>(".monaco-hover") ?? widgetNode;
    const scrollNode = hoverNode.querySelector<HTMLElement>(".monaco-scrollable-element");
    const contentNode = hoverNode.querySelector<HTMLElement>(".monaco-hover-content");
    const nextWidth = Math.min(maxWidth, Math.max(120, hoverNode.getBoundingClientRect().width));

    for (const node of [widgetNode, hoverNode, scrollNode, contentNode]) {
      if (!node) continue;
      setStyleProperty(node, "maxWidth", `${maxWidth}px`);
      if (node.getBoundingClientRect().width > maxWidth) {
        setStyleProperty(node, "width", `${nextWidth}px`);
      }
    }

    const widgetRect = widgetNode.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const currentLeft = widgetRect.left - containerRect.left;
    let nextLeft = currentLeft;

    if (currentLeft + nextWidth > container.clientWidth - margin) {
      nextLeft = container.clientWidth - nextWidth - margin;
    }
    if (nextLeft < margin) {
      nextLeft = margin;
    }
    if (nextLeft !== currentLeft) {
      setStyleProperty(widgetNode, "left", `${nextLeft}px`);
    }
  }
}
