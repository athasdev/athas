import { memo, useEffect, useRef } from "react";
import { useEditorSettingsStore } from "../../stores/settings-store";
import type { Token } from "../../utils/html";

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
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const lines = content.split("\n");
    const scaledLineHeight = lineHeight * scale;
    const charWidth = 1.5;

    // Create a map of tokens by line for efficient lookup
    const tokensByLine = new Map<number, Token[]>();
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineStart = currentOffset;
      const lineEnd = currentOffset + lines[i].length;
      const lineTokens: Token[] = [];

      for (const token of tokens) {
        if (token.start < lineEnd && token.end > lineStart) {
          lineTokens.push(token);
        }
      }

      tokensByLine.set(i, lineTokens);
      currentOffset = lineEnd + 1; // +1 for newline
    }

    // Draw each line
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const y = lineIndex * scaledLineHeight;

      // Skip if outside visible area
      if (y > height) break;
      if (y + scaledLineHeight < 0) continue;

      const lineTokens = tokensByLine.get(lineIndex) || [];
      let lineStart = 0;

      for (let i = 0; i < lineIndex; i++) {
        lineStart += lines[i].length + 1;
      }

      // Draw tokens as colored rectangles
      if (lineTokens.length > 0) {
        for (const token of lineTokens) {
          const tokenStartInLine = Math.max(0, token.start - lineStart);
          const tokenEndInLine = Math.min(line.length, token.end - lineStart);

          if (tokenEndInLine <= tokenStartInLine) continue;

          const x = tokenStartInLine * charWidth * scale;
          const tokenWidth = (tokenEndInLine - tokenStartInLine) * charWidth * scale;

          ctx.fillStyle = tokenColors[token.class_name] || defaultColor;
          ctx.fillRect(x, y, Math.max(tokenWidth, 1), Math.max(scaledLineHeight - 1, 1));
        }
      } else if (line.trim().length > 0) {
        // Draw line without tokens as default color
        const trimStart = line.length - line.trimStart().length;
        const trimEnd = line.trimEnd().length;
        const x = trimStart * charWidth * scale;
        const lineWidth = (trimEnd - trimStart) * charWidth * scale;

        ctx.fillStyle = defaultColor;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, y, Math.max(lineWidth, 1), Math.max(scaledLineHeight - 1, 1));
        ctx.globalAlpha = 1;
      }
    }
  }, [content, tokens, width, height, scale, lineHeight, theme]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
}

export const MinimapCanvas = memo(MinimapCanvasComponent);
