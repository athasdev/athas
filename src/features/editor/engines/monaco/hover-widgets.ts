import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";

const MONACO_HOVER_MIN_WIDTH = 120;
const MONACO_HOVER_MAX_WIDTH = 720;
const MONACO_HOVER_MIN_HEIGHT = 48;

function setStyleProperty(
  element: HTMLElement,
  property:
    | "background"
    | "border"
    | "boxShadow"
    | "height"
    | "left"
    | "maxHeight"
    | "maxWidth"
    | "top"
    | "width",
  value: string,
) {
  if (element.style[property] === value) return;
  element.style[property] = value;
}

function getMonacoHoverMaxWidth(container: HTMLElement) {
  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const availableWidth = Math.max(MONACO_HOVER_MIN_WIDTH, container.clientWidth - margin * 2);
  return Math.min(MONACO_HOVER_MAX_WIDTH, availableWidth);
}

function getMonacoHoverMaxHeight(container: HTMLElement) {
  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const availableHeight = Math.max(MONACO_HOVER_MIN_HEIGHT, container.clientHeight - margin * 2);
  return Math.min(EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT, availableHeight);
}

function getMonacoHoverContentWidth(nodes: Array<HTMLElement | null>) {
  return nodes.reduce((width, node) => {
    if (!node) return width;
    const contentWidth = Array.from(node.children).reduce(
      (childWidth, child) =>
        child instanceof HTMLElement ? Math.max(childWidth, child.scrollWidth) : childWidth,
      node.scrollWidth,
    );
    return Math.max(width, contentWidth);
  }, MONACO_HOVER_MIN_WIDTH);
}

export function syncMonacoHoverBounds(container: HTMLElement) {
  const maxWidth = getMonacoHoverMaxWidth(container);
  container.style.setProperty("--athas-monaco-hover-max-width", `${maxWidth}px`);
}

export function clampMonacoHoverWidgets(container: HTMLElement) {
  syncMonacoHoverBounds(container);

  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const maxWidth = getMonacoHoverMaxWidth(container);
  const maxHeight = getMonacoHoverMaxHeight(container);
  const widgetNodes = container.querySelectorAll<HTMLElement>(
    '[widgetid="editor.contrib.resizableContentHoverWidget"], [widgetid="editor.contrib.modesGlyphHoverWidget"]',
  );

  for (const widgetNode of widgetNodes) {
    const hoverNode = widgetNode.querySelector<HTMLElement>(".monaco-hover") ?? widgetNode;
    const scrollNode = hoverNode.querySelector<HTMLElement>(".monaco-scrollable-element");
    const contentNode = hoverNode.querySelector<HTMLElement>(".monaco-hover-content");
    const nextWidth = Math.min(maxWidth, getMonacoHoverContentWidth([scrollNode, contentNode]));

    setStyleProperty(widgetNode, "background", "transparent");
    setStyleProperty(widgetNode, "border", "0");
    setStyleProperty(widgetNode, "boxShadow", "none");

    for (const node of [widgetNode, hoverNode, scrollNode, contentNode]) {
      if (!node) continue;
      setStyleProperty(node, "maxHeight", `${maxHeight}px`);
      setStyleProperty(node, "maxWidth", `${maxWidth}px`);
      if (node.getBoundingClientRect().width !== nextWidth) {
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

    const nextWidgetRect = widgetNode.getBoundingClientRect();
    const currentTop = nextWidgetRect.top - containerRect.top;
    const nextHeight = Math.min(
      maxHeight,
      Math.max(MONACO_HOVER_MIN_HEIGHT, nextWidgetRect.height),
    );
    let nextTop = currentTop;

    if (currentTop + nextHeight > container.clientHeight - margin) {
      nextTop = container.clientHeight - nextHeight - margin;
    }
    if (nextTop < margin) {
      nextTop = margin;
    }
    if (nextTop !== currentTop) {
      setStyleProperty(widgetNode, "top", `${nextTop}px`);
    }

    if (nextWidgetRect.height > maxHeight) {
      for (const node of [widgetNode, hoverNode, scrollNode]) {
        if (!node) continue;
        setStyleProperty(node, "height", `${maxHeight}px`);
      }
    }
  }
}
