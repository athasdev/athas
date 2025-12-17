import { EDITOR_CONSTANTS } from "../config/constants";

export function splitLines(content: string): string[] {
  return content.split("\n");
}

export function calculateLineHeight(fontSize: number): number {
  // Use Math.ceil to match getLineHeight() in position.ts
  // Fractional line-height causes subpixel misalignment between layers
  return Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
}

export function calculateLineOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).reduce((acc, line) => acc + line.length + 1, 0);
}

export function isMarkdownFile(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension === "md" || extension === "markdown";
}

// Reusable DOM element for text measurement (more accurate than canvas)
let measureElement: HTMLSpanElement | null = null;

function getMeasureElement(): HTMLSpanElement {
  if (!measureElement) {
    measureElement = document.createElement("span");
    measureElement.style.position = "absolute";
    measureElement.style.visibility = "hidden";
    measureElement.style.whiteSpace = "pre";
    measureElement.style.top = "-9999px";
    measureElement.style.left = "-9999px";
    document.body.appendChild(measureElement);
  }
  return measureElement;
}

/**
 * Measure the width of a text string in pixels using DOM measurement
 * @param text The text to measure
 * @param fontSize Font size in pixels
 * @param fontFamily Font family string
 * @param tabSize Tab size for tab character expansion
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
  tabSize: number,
): number {
  const element = getMeasureElement();
  element.style.fontSize = `${fontSize}px`;
  element.style.fontFamily = fontFamily;
  element.style.tabSize = String(tabSize);

  element.textContent = text;
  return element.getBoundingClientRect().width;
}

/**
 * Calculate the maximum width of lines within a range
 * @param lines Array of line strings
 * @param startLine Start of range (inclusive)
 * @param endLine End of range (exclusive)
 * @param fontSize Font size in pixels
 * @param fontFamily Font family string
 * @param tabSize Tab size for tab character expansion
 */
/**
 * Smoothly animate an element's scrollLeft to a target value
 * @param element The element to animate
 * @param targetScrollLeft Target scrollLeft value
 * @param duration Animation duration in ms
 * @returns Cleanup function to cancel the animation
 */
export function animateScrollLeft(
  element: HTMLElement,
  targetScrollLeft: number,
  duration: number = 150,
): () => void {
  const startScrollLeft = element.scrollLeft;
  const distance = targetScrollLeft - startScrollLeft;

  if (distance === 0) return () => {};

  const startTime = performance.now();
  let animationId: number | null = null;

  const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easeOutCubic(progress);

    element.scrollLeft = startScrollLeft + distance * easedProgress;

    if (progress < 1) {
      animationId = requestAnimationFrame(animate);
    }
  };

  animationId = requestAnimationFrame(animate);

  return () => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
  };
}

export function getMaxVisibleLineWidth(
  lines: string[],
  startLine: number,
  endLine: number,
  fontSize: number,
  fontFamily: string,
  tabSize: number,
): { maxWidth: number; longestLineIndex: number; longestLineLength: number } {
  let maxWidth = 0;
  let longestLineIndex = startLine;
  const actualEnd = Math.min(endLine, lines.length);

  for (let i = startLine; i < actualEnd; i++) {
    const lineWidth = measureTextWidth(lines[i], fontSize, fontFamily, tabSize);
    if (lineWidth > maxWidth) {
      maxWidth = lineWidth;
      longestLineIndex = i;
    }
  }

  return {
    maxWidth,
    longestLineIndex,
    longestLineLength: lines[longestLineIndex]?.length ?? 0,
  };
}
