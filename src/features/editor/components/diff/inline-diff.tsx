import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { GitDiffLine } from "@/features/version-control/git/types/git";

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
  const oldHighlights: boolean[] = new Array(oldStr.length).fill(false);
  const newHighlights: boolean[] = new Array(newStr.length).fill(false);

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
                    ? "rgba(248, 81, 73, 0.4)"
                    : "rgba(46, 160, 67, 0.4)"
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
        return "rgba(46, 160, 67, 0.2)";
      case "removed":
        return "rgba(248, 81, 73, 0.2)";
      default:
        return "transparent";
    }
  };

  const getLineColor = (lineType: GitDiffLine["line_type"]) => {
    switch (lineType) {
      case "added":
        return "var(--git-added, #2ea043)";
      case "removed":
        return "var(--git-deleted, #f85149)";
      default:
        return "var(--text-light, rgba(255, 255, 255, 0.5))";
    }
  };

  const getPrefix = (lineType: GitDiffLine["line_type"]) => {
    switch (lineType) {
      case "added":
        return "+";
      case "removed":
        return "-";
      default:
        return " ";
    }
  };

  const topPosition = (lineNumber + 1) * lineHeight + 8;

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
        zIndex: 20,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {linesToShow.length > 0 ? (
        linesToShow.map((line, idx) => (
          <div
            key={idx}
            style={{
              position: "relative",
              display: "flex",
              height: `${lineHeight}px`,
              lineHeight: `${lineHeight}px`,
              fontSize: `${fontSize}px`,
              fontFamily,
              backgroundColor: getLineBackground(line.line_type),
              paddingLeft: "1rem",
            }}
          >
            <span
              style={{
                color: getLineColor(line.line_type),
                fontWeight: 600,
                width: "16px",
                flexShrink: 0,
                opacity: 0.8,
              }}
            >
              {getPrefix(line.line_type)}
            </span>
            <span
              style={{
                color: "var(--text, #d4d4d4)",
                display: "flex",
                flex: 1,
                overflow: "hidden",
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
            </span>

            {isHovered && idx === 0 && (
              <div
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "flex",
                  gap: "4px",
                  backgroundColor: "var(--secondary-bg, #2a2a2a)",
                  borderRadius: "4px",
                  padding: "2px 4px",
                }}
              >
                {onRevert && line.line_type === "removed" && (
                  <button
                    type="button"
                    onClick={handleRevert}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text, #d4d4d4)",
                      cursor: "pointer",
                      padding: "2px 6px",
                      fontSize: "11px",
                      borderRadius: "3px",
                    }}
                    title="Revert this change"
                    aria-label="Revert change"
                  >
                    ↺
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-light, rgba(255, 255, 255, 0.5))",
                    cursor: "pointer",
                    padding: "2px 6px",
                    fontSize: "11px",
                    borderRadius: "3px",
                  }}
                  title="Close"
                  aria-label="Close diff"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))
      ) : (
        <div
          style={{
            height: `${lineHeight}px`,
            lineHeight: `${lineHeight}px`,
            fontSize: `${fontSize}px`,
            fontFamily,
            paddingLeft: "1rem",
            color: "var(--text-light, rgba(255, 255, 255, 0.5))",
            fontStyle: "italic",
            backgroundColor: "rgba(128, 128, 128, 0.1)",
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
