import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, X } from "@phosphor-icons/react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { GitDiffLine } from "@/features/git/types/git-types";
import { Button } from "@/ui/button";

interface InlineDiffProps {
  lineNumber: number;
  type: "added" | "modified" | "deleted";
  diffLines: GitDiffLine[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  onClose: () => void;
  onRevert?: (lineNumber: number, originalContent: string) => void;
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

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
      clearTimeout(timer);
    };
  }, [onClose]);

  const linesToShow = diffLines.filter((line) => {
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

  const getLineNumber = (line: GitDiffLine) => {
    if (line.line_type === "removed") return line.old_line_number ?? "";
    if (line.line_type === "added") return line.new_line_number ?? "";
    return line.new_line_number ?? line.old_line_number ?? "";
  };

  const topPosition = EDITOR_CONSTANTS.EDITOR_PADDING_TOP + (lineNumber + 1) * lineHeight;

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
        left: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px`,
        right: `${EDITOR_CONSTANTS.EDITOR_PADDING_RIGHT}px`,
        pointerEvents: "auto",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        backgroundColor: "var(--primary-bg)",
        boxShadow: "0 12px 32px color-mix(in srgb, var(--shadow, #000) 26%, transparent)",
        overflow: "hidden",
        zIndex: EDITOR_CONSTANTS.Z_INDEX.OVERLAY,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: "28px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--secondary-bg)",
          color: "var(--text-light)",
          fontSize: "12px",
          fontFamily: "var(--app-ui-font-family)",
          padding: "0 8px",
          gap: "8px",
        }}
      >
        <span style={{ color: "var(--text)", fontWeight: 500 }}>Working tree change</span>
        <span style={{ color: "var(--text-lighter)" }}>line {lineNumber + 1}</span>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            opacity: isHovered ? 1 : 0.72,
          }}
        >
          {onRevert && linesToShow.some((line) => line.line_type === "removed") && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleRevert}
              tooltip="Revert this change"
              aria-label="Revert change"
            >
              <ArrowCounterClockwise />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            tooltip="Close"
            shortcut="escape"
            aria-label="Close diff"
          >
            <X />
          </Button>
        </div>
      </div>
      {linesToShow.length > 0 ? (
        <div
          style={{
            maxHeight: `${Math.max(lineHeight * 8, 160)}px`,
            overflow: "auto",
          }}
        >
          {linesToShow.map((line, idx) => (
            <div
              key={idx}
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "48px 24px minmax(0, 1fr)",
                minHeight: `${lineHeight}px`,
                lineHeight: `${lineHeight}px`,
                fontSize: `${fontSize}px`,
                fontFamily,
                backgroundColor: getLineBackground(line.line_type),
                borderLeft: `3px solid ${getLineAccent(line.line_type)}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: "10px",
                  color: "var(--text-lighter)",
                  backgroundColor: "color-mix(in srgb, var(--secondary-bg) 72%, transparent)",
                  userSelect: "none",
                }}
              >
                {getLineNumber(line)}
              </div>
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
            paddingLeft: "72px",
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
