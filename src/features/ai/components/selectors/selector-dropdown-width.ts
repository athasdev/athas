const FALLBACK_AVERAGE_CHAR_WIDTH = 7;

let measurementCanvas: HTMLCanvasElement | null = null;

function getTextWidth(text: string) {
  if (typeof document === "undefined") {
    return text.length * FALLBACK_AVERAGE_CHAR_WIDTH;
  }

  measurementCanvas ??= document.createElement("canvas");
  const context = measurementCanvas.getContext("2d");
  if (!context) return text.length * FALLBACK_AVERAGE_CHAR_WIDTH;

  const fontFamily = window.getComputedStyle(document.body).fontFamily || "system-ui";
  context.font = `12px ${fontFamily}`;
  return context.measureText(text).width;
}

export function getSelectorDropdownWidth({
  labels,
  min,
  max,
  chrome,
}: {
  labels: string[];
  min: number;
  max: number;
  chrome: number;
}) {
  const widestLabel = labels.reduce((width, label) => Math.max(width, getTextWidth(label)), 0);
  return Math.min(max, Math.max(min, Math.ceil(widestLabel + chrome)));
}
