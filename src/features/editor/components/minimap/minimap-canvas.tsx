import { memo, useEffect, useRef } from "react";
import { useEditorSettingsStore } from "../../stores/settings-store";
import type { Token } from "../../utils/html";
import {
  bucketTokensByLine,
  buildMinimapLineMetrics,
  getMinimapHorizontalMetrics,
} from "./minimap-utils";

interface MinimapCanvasProps {
  content: string;
  tokens: Token[];
  width: number;
  height: number;
  scale: number;
  lineHeight: number;
}

const CSS_VAR_MAP: Record<string, string> = {
  "token-keyword": "--syntax-keyword",
  "token-string": "--syntax-string",
  "token-comment": "--syntax-comment",
  "token-number": "--syntax-number",
  "token-function": "--syntax-function",
  "token-variable": "--syntax-variable",
  "token-type": "--syntax-type",
  "token-property": "--syntax-property",
  "token-punctuation": "--syntax-punctuation",
  "token-operator": "--syntax-punctuation",
  "token-constant": "--syntax-constant",
  "token-tag": "--syntax-tag",
  "token-attribute": "--syntax-attribute",
};

function resolveTokenColors(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const [tokenClass, cssVar] of Object.entries(CSS_VAR_MAP)) {
    colors[tokenClass] = style.getPropertyValue(cssVar).trim() || "#d4d4d4";
  }
  return colors;
}

function resolveDefaultColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#d4d4d4";
}

function drawMinimapSpan({
  ctx,
  startColumn,
  endColumn,
  y,
  xOffset,
  charWidth,
  lineHeight,
  color,
  width,
  alpha = 1,
}: {
  ctx: CanvasRenderingContext2D;
  startColumn: number;
  endColumn: number;
  y: number;
  xOffset: number;
  charWidth: number;
  lineHeight: number;
  color: string;
  width: number;
  alpha?: number;
}) {
  if (endColumn <= startColumn) return;

  const x = xOffset + startColumn * charWidth;
  if (x >= width) return;

  const spanWidth = Math.min(width - x, (endColumn - startColumn) * charWidth);
  if (spanWidth <= 0) return;

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, Math.max(spanWidth, 0.75), Math.max(lineHeight - 1, 1));
  ctx.globalAlpha = 1;
}

function MinimapCanvasComponent({
  content,
  tokens,
  width,
  height,
  scale,
  lineHeight,
}: MinimapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useEditorSettingsStore.use.theme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tokenColors = resolveTokenColors();
    const defaultColor = resolveDefaultColor();

    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const { lines, lineStarts } = buildMinimapLineMetrics(content);
    const scaledLineHeight = lineHeight * scale;
    const xOffset = 3;
    const { charWidth } = getMinimapHorizontalMetrics({ lines, width, horizontalPadding: xOffset });
    const tokensByLine = bucketTokensByLine(tokens, lineStarts, lines);

    // Draw each line
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const y = lineIndex * scaledLineHeight;

      // Skip if outside visible area
      if (y > height) break;
      if (y + scaledLineHeight < 0) continue;

      const lineTokens = tokensByLine.get(lineIndex) || [];
      const lineStart = lineStarts[lineIndex] ?? 0;
      const lineEnd = line.length;

      // Draw tokens as colored rectangles
      if (lineTokens.length > 0) {
        let lastColumn = 0;
        const sortedLineTokens = [...lineTokens].sort((a, b) => a.start - b.start);

        for (const token of sortedLineTokens) {
          const tokenStartInLine = Math.max(0, token.start - lineStart);
          const tokenEndInLine = Math.min(line.length, token.end - lineStart);

          if (tokenEndInLine <= tokenStartInLine) continue;

          drawMinimapSpan({
            ctx,
            startColumn: lastColumn,
            endColumn: tokenStartInLine,
            y,
            xOffset,
            charWidth,
            lineHeight: scaledLineHeight,
            color: defaultColor,
            width,
            alpha: 0.45,
          });

          drawMinimapSpan({
            ctx,
            startColumn: tokenStartInLine,
            endColumn: tokenEndInLine,
            y,
            xOffset,
            charWidth,
            lineHeight: scaledLineHeight,
            color: tokenColors[token.class_name] || defaultColor,
            width,
          });

          lastColumn = Math.max(lastColumn, tokenEndInLine);
        }

        drawMinimapSpan({
          ctx,
          startColumn: lastColumn,
          endColumn: lineEnd,
          y,
          xOffset,
          charWidth,
          lineHeight: scaledLineHeight,
          color: defaultColor,
          width,
          alpha: 0.45,
        });
      } else if (line.trim().length > 0) {
        // Draw line without tokens as default color
        const trimStart = line.length - line.trimStart().length;
        const trimEnd = line.trimEnd().length;
        drawMinimapSpan({
          ctx,
          startColumn: trimStart,
          endColumn: trimEnd,
          y,
          xOffset,
          charWidth,
          lineHeight: scaledLineHeight,
          color: defaultColor,
          width,
          alpha: 0.5,
        });
      }
    }
  }, [content, tokens, width, height, scale, lineHeight, theme]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: "block",
      }}
    />
  );
}

export const MinimapCanvas = memo(MinimapCanvasComponent);
