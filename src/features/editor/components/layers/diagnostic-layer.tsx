import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { buildLineOffsetMap, normalizeLineEndings } from "@/features/editor/utils/html";
import { calculateSelectionBoxes } from "@/features/editor/utils/selection-boxes";
import type { EditorViewLayout } from "@/features/editor/view-model/view-layout";

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
}

interface DiagnosticLayerProps {
  filePath?: string;
  content: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  viewportRange?: { startLine: number; endLine: number };
  viewLayout?: EditorViewLayout;
  foldMapping?: LineMapping;
}

interface DiagnosticBox {
  diagnostic: Diagnostic;
  top: number;
  left: number;
  width: number;
  height: number;
}

const VIEWPORT_BUFFER_LINES = 20;

function getDiagnosticColor(severity: Diagnostic["severity"]): string {
  if (severity === "error") return "var(--error, #f85149)";
  if (severity === "warning") return "var(--warning, #d29922)";
  return "var(--info, #58a6ff)";
}

function formatDiagnosticMessage(diagnostic: Diagnostic): string {
  const details = [
    diagnostic.message,
    diagnostic.source ? `Source: ${diagnostic.source}` : "",
    diagnostic.code ? `Code: ${diagnostic.code}` : "",
  ].filter(Boolean);
  return details.join("\n\n");
}

function buildWavyPath(width: number): string {
  const segmentWidth = 6;
  const safeWidth = Math.max(segmentWidth, Math.ceil(width));
  let path = "M 0 4";

  for (let x = 0; x < safeWidth; x += segmentWidth) {
    path += ` Q ${x + segmentWidth / 4} 0 ${x + segmentWidth / 2} 4`;
    path += ` T ${x + segmentWidth} 4`;
  }

  return path;
}

function isLineVisible(line: number, foldMapping?: LineMapping): boolean {
  if (!foldMapping) return true;
  const virtualLine = foldMapping.actualToVirtual.get(line);
  if (virtualLine === undefined) return false;
  return foldMapping.virtualToActual.get(virtualLine) === line;
}

function toVisualLine(line: number, foldMapping?: LineMapping): number {
  return foldMapping?.actualToVirtual.get(line) ?? line;
}

function getLineOffset(lineOffsets: number[], line: number, column: number, lines: string[]) {
  const lineStart = lineOffsets[line] ?? 0;
  const lineText = lines[line] ?? "";
  return lineStart + Math.max(0, Math.min(column, lineText.length));
}

const DiagnosticLayerComponent = ({
  filePath,
  content,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  viewportRange,
  viewLayout,
  foldMapping,
}: DiagnosticLayerProps) => {
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const setHoverInfo = useEditorUIStore.use.actions().setHoverInfo;
  const measureRef = useRef<HTMLSpanElement>(null);
  const [boxes, setBoxes] = useState<DiagnosticBox[]>([]);

  const normalizedContent = useMemo(() => normalizeLineEndings(content), [content]);
  const lines = useMemo(() => normalizedContent.split("\n"), [normalizedContent]);
  const lineOffsets = useMemo(() => buildLineOffsetMap(normalizedContent), [normalizedContent]);
  const diagnostics = useMemo(() => {
    if (!filePath) return [];
    return diagnosticsByFile.get(filePath) ?? [];
  }, [diagnosticsByFile, filePath]);

  useEffect(() => {
    const measure = measureRef.current;
    if (!measure || diagnostics.length === 0) {
      setBoxes([]);
      return;
    }

    const viewportStartLine = Math.max(0, (viewportRange?.startLine ?? 0) - VIEWPORT_BUFFER_LINES);
    const viewportEndLine = Math.min(
      lines.length,
      (viewportRange?.endLine ?? lines.length) + VIEWPORT_BUFFER_LINES,
    );

    const getTextWidth = (text: string): number => {
      measure.textContent = text;
      return measure.getBoundingClientRect().width;
    };

    const nextBoxes: DiagnosticBox[] = [];

    for (const diagnostic of diagnostics) {
      if (!isLineVisible(diagnostic.line, foldMapping)) continue;

      const visualStartLine = toVisualLine(diagnostic.line, foldMapping);
      const visualEndLine = Math.max(
        visualStartLine,
        toVisualLine(diagnostic.endLine, foldMapping),
      );
      if (visualStartLine >= viewportEndLine || visualEndLine < viewportStartLine) continue;

      const startOffset = getLineOffset(lineOffsets, visualStartLine, diagnostic.column, lines);
      let endOffset = getLineOffset(lineOffsets, visualEndLine, diagnostic.endColumn, lines);

      if (endOffset <= startOffset) {
        const lineText = lines[visualStartLine] ?? "";
        const fallbackEndColumn = Math.min(lineText.length, diagnostic.column + 1);
        endOffset = getLineOffset(lineOffsets, visualStartLine, fallbackEndColumn, lines);
      }

      const diagnosticBoxes = calculateSelectionBoxes({
        selectionOffsets: { start: startOffset, end: endOffset },
        lines,
        lineOffsets,
        contentLength: normalizedContent.length,
        lineHeight,
        measureText: getTextWidth,
        viewLayout,
      });

      nextBoxes.push(
        ...diagnosticBoxes.map((box) => ({
          diagnostic,
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
        })),
      );
    }

    setBoxes(nextBoxes);
  }, [
    diagnostics,
    foldMapping,
    lineHeight,
    lineOffsets,
    lines,
    normalizedContent.length,
    viewportRange,
    viewLayout,
  ]);

  if (diagnostics.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <span
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "pre",
          fontSize: `${fontSize}px`,
          fontFamily,
          tabSize,
        }}
      />
      {boxes.map((box, index) => (
        <div
          key={`${box.diagnostic.line}-${box.diagnostic.column}-${index}`}
          className="pointer-events-auto absolute"
          style={{
            top: `${box.top}px`,
            left: `${box.left}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
          onMouseEnter={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHoverInfo({
              content: formatDiagnosticMessage(box.diagnostic),
              position: {
                top: rect.bottom + 8,
                left: rect.left,
              },
            });
          }}
          onMouseLeave={() => setHoverInfo(null)}
        >
          <svg
            aria-hidden="true"
            width="100%"
            height="6"
            viewBox={`0 0 ${Math.max(6, Math.ceil(box.width))} 6`}
            preserveAspectRatio="none"
            className="absolute bottom-0 left-0 block"
          >
            <path
              d={buildWavyPath(box.width)}
              fill="none"
              stroke={getDiagnosticColor(box.diagnostic.severity)}
              strokeLinecap="round"
              strokeWidth="1.4"
            />
          </svg>
        </div>
      ))}
    </div>
  );
};

DiagnosticLayerComponent.displayName = "DiagnosticLayer";

export const DiagnosticLayer = memo(DiagnosticLayerComponent);
