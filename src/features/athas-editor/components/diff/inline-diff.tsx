import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwiseIcon as ArrowCounterClockwise,
  XIcon as X,
} from "@phosphor-icons/react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { GitDiffLine } from "@/features/git/types/git.types";
import { Button } from "@/ui/button";

interface InlineDiffProps {
  lineNumber: number;
  type: "added" | "modified" | "deleted";
  diffLines: GitDiffLine[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  top?: number;
  onClose: () => void;
  onRevert?: (lineNumber: number, originalContent: string) => void;
}

const INLINE_DIFF_MAX_VISIBLE_LINES = 8;
const INLINE_DIFF_CHROME_HEIGHT = 2;

export function calculateInlineDiffHeight(diffLinesCount: number, lineHeight: number): number {
  if (diffLinesCount <= 0) {
    return lineHeight + INLINE_DIFF_CHROME_HEIGHT;
  }

  return (
    Math.min(diffLinesCount, INLINE_DIFF_MAX_VISIBLE_LINES) * lineHeight + INLINE_DIFF_CHROME_HEIGHT
  );
}

export function getInlineDiffLinesToShow(
  diffLines: GitDiffLine[],
  lineNumber: number,
  type: "added" | "modified" | "deleted",
): GitDiffLine[] {
  return diffLines.filter((line) => {
    if (type === "added") {
      return line.new_line_number === lineNumber + 1 && line.line_type === "added";
    }
    if (type === "deleted") {
      return line.old_line_number === lineNumber + 1 && line.line_type === "removed";
    }
    return (
      (line.old_line_number === lineNumber + 1 && line.line_type === "removed") ||
      (line.new_line_number === lineNumber + 1 && line.line_type === "added")
    );
  });
}

function highlightCharDiff(
  oldStr: string,
  newStr: string,
): { oldHighlights: boolean[]; newHighlights: boolean[] } {
  const oldHighlights: boolean[] = Array.from({ length: oldStr.length }, () => false);
  const newHighlights: boolean[] = Array.from({ length: newStr.length }, () => false);

  let prefixLen = 0;
  while (
    prefixLen < oldStr.length &&
    prefixLen < newStr.length &&
    oldStr[prefixLen] === newStr[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldStr.length - prefixLen &&
    suffixLen < newStr.length - prefixLen &&
    oldStr[oldStr.length - 1 - suffixLen] === newStr[newStr.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  for (let i = prefixLen; i < oldStr.length - suffixLen; i++) {
    oldHighlights[i] = true;
  }
  for (let i = prefixLen; i < newStr.length - suffixLen; i++) {
    newHighlights[i] = true;
  }

  return { oldHighlights, newHighlights };
}

function InlineDiffComponent({
  lineNumber,
  type,
  diffLines,
  fontSize,
  fontFamily,
  lineHeight,
  top,
  onClose,
  onRevert,
}: InlineDiffProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const linesToShow = getInlineDiffLinesToShow(diffLines, lineNumber, type);

  const charHighlights = useMemo(() => {
    if (type !== "modified") return null;

    const removedLine = linesToShow.find((l) => l.line_type === "removed");
    const addedLine = linesToShow.find((l) => l.line_type === "added");

    if (removedLine && addedLine) {
      return highlightCharDiff(removedLine.content, addedLine.content);
    }
    return null;
  }, [type, linesToShow]);

  const renderHighlightedContent = (
    content: string,
    highlights: boolean[] | null,
    lineType: string,
  ) => {
    if (!highlights) {
      return <span style={{ whiteSpace: "pre", overflow: "hidden", flex: 1 }}>{content}</span>;
    }

    const segments: React.ReactElement[] = [];
    let currentSegment = "";
    let currentHighlighted = false;

    for (let i = 0; i <= content.length; i++) {
      const isHighlighted = i < content.length ? highlights[i] : false;

      if (i === content.length || isHighlighted !== currentHighlighted) {
        if (currentSegment) {
          segments.push(
            <span
              key={segments.length}
              style={{
                whiteSpace: "pre",
                backgroundColor: currentHighlighted
                  ? lineType === "removed"
                    ? "color-mix(in srgb, var(--git-deleted, #f85149) 36%, transparent)"
                    : "color-mix(in srgb, var(--git-added, #2ea043) 36%, transparent)"
                  : "transparent",
                borderRadius: currentHighlighted ? "2px" : "0",
              }}
            >
              {currentSegment}
            </span>,
          );
        }
        currentSegment = i < content.length ? content[i] : "";
        currentHighlighted = isHighlighted;
      } else {
        currentSegment += content[i];
      }
    }

    return <span style={{ whiteSpace: "pre", overflow: "hidden", flex: 1 }}>{segments}</span>;
  };

  const getLineBackground = (lineType: GitDiffLine["line_type"]) => {
    switch (lineType) {
      case "added":
        return "color-mix(in srgb, var(--git-added, #2ea043) 16%, var(--primary-bg))";
      case "removed":
        return "color-mix(in srgb, var(--git-deleted, #f85149) 16%, var(--primary-bg))";
      default:
        return "var(--primary-bg)";
    }
  };

  const getLineAccent = (lineType: GitDiffLine["line_type"]) => {
    if (lineType === "added") return "var(--git-added, #2ea043)";
    if (lineType === "removed") return "var(--git-deleted, #f85149)";
    return "var(--border)";
  };

  const getLineMarker = (lineType: GitDiffLine["line_type"]) => {
    if (lineType === "added") return "+";
    if (lineType === "removed") return "-";
    return " ";
  };

  const topPosition = top ?? EDITOR_CONSTANTS.EDITOR_PADDING_TOP + (lineNumber + 1) * lineHeight;

  const handleRevert = () => {
    if (!onRevert) return;
    const removedLine = linesToShow.find((l) => l.line_type === "removed");
    if (removedLine) {
      onRevert(lineNumber, removedLine.content);
    }
    onClose();
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: `${topPosition}px`,
        left: 0,
        right: 0,
        pointerEvents: "auto",
        borderTop: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
        borderBottom: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
        backgroundColor: "var(--primary-bg)",
        overflow: "hidden",
        zIndex: EDITOR_CONSTANTS.Z_INDEX.OVERLAY,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          right: "6px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          opacity: isHovered ? 1 : 0,
          transition: "opacity 120ms ease",
          zIndex: 1,
        }}
      >
        {onRevert && linesToShow.some((line) => line.line_type === "removed") && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleRevert}
            tooltip="Revert this change"
            aria-label="Revert change"
            compact
          >
            <ArrowCounterClockwise />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          tooltip="Close"
          shortcut="escape"
          aria-label="Close diff"
          compact
        >
          <X />
        </Button>
      </div>
      {linesToShow.length > 0 ? (
        <div
          style={{
            maxHeight: `${calculateInlineDiffHeight(linesToShow.length, lineHeight)}px`,
            overflow: "auto",
          }}
        >
          {linesToShow.map((line, idx) => (
            <div
              key={idx}
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px 22px minmax(0, 1fr)`,
                minHeight: `${lineHeight}px`,
                lineHeight: `${lineHeight}px`,
                fontSize: `${fontSize}px`,
                fontFamily,
                backgroundColor: getLineBackground(line.line_type),
                boxShadow: `inset 3px 0 0 ${getLineAccent(line.line_type)}`,
              }}
            >
              <div />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: getLineAccent(line.line_type),
                  userSelect: "none",
                }}
              >
                {getLineMarker(line.line_type)}
              </div>
              <div
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  color: "var(--text)",
                  paddingRight: "12px",
                }}
              >
                {renderHighlightedContent(
                  line.content,
                  charHighlights
                    ? line.line_type === "removed"
                      ? charHighlights.oldHighlights
                      : charHighlights.newHighlights
                    : null,
                  line.line_type,
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            height: `${lineHeight}px`,
            lineHeight: `${lineHeight}px`,
            fontSize: `${fontSize}px`,
            fontFamily,
            paddingLeft: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px`,
            color: "var(--text-light)",
            fontStyle: "italic",
            backgroundColor: "var(--primary-bg)",
          }}
        >
          No diff available
        </div>
      )}
    </div>
  );
}

InlineDiffComponent.displayName = "InlineDiff";

export const InlineDiff = memo(InlineDiffComponent);
