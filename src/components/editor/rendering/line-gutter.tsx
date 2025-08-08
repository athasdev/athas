import type { Decoration } from "@/types/editor-types";
import { cn } from "@/utils/cn";

interface LineGutterProps {
  lineNumber: number;
  showLineNumbers: boolean;
  gutterWidth: number;
  decorations: Decoration[];
  isBreakpoint?: boolean;
  hasError?: boolean;
  hasWarning?: boolean;
}

export const LineGutter = ({
  lineNumber,
  showLineNumbers,
  gutterWidth,
  decorations,
  isBreakpoint = false,
  hasError = false,
  hasWarning = false,
}: LineGutterProps) => {
  const gutterDecorations = decorations.filter(
    (d) => d.type === "gutter" && d.range.start.line === lineNumber,
  );

  // Separate git decorations from other decorations
  const gitDecorations = gutterDecorations.filter((d) => d.className?.includes("git-gutter"));
  const otherDecorations = gutterDecorations.filter((d) => !d.className?.includes("git-gutter"));

  return (
    <div
      className={cn(
        "editor-gutter relative mx-2",
        isBreakpoint && "has-breakpoint",
        hasError && "has-error",
        hasWarning && "has-warning",
      )}
      style={{
        width: `${gutterWidth}px`,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: showLineNumbers ? "flex-end" : "center",
        position: "relative",
      }}
      data-line-number={lineNumber}
    >
      {/* Git gutter indicators positioned absolutely on the left edge */}
      {gitDecorations.map((decoration, index) => (
        <div
          key={`git-decoration-${index}`}
          className={cn("gutter-decoration", decoration.className)}
          style={{
            position: "absolute",
            left: "0px",
            top: decoration.className?.includes("git-gutter-deleted") ? "0px" : "50%",
            transform: decoration.className?.includes("git-gutter-deleted")
              ? "none"
              : "translateY(-50%)",
            width: "3px",
            height: decoration.className?.includes("git-gutter-deleted") ? "2px" : "100%",
            zIndex: 1,
          }}
          title={
            decoration.className?.includes("git-gutter-added")
              ? `Line ${lineNumber + 1}: Added in working directory`
              : decoration.className?.includes("git-gutter-modified")
                ? `Line ${lineNumber + 1}: Modified in working directory`
                : decoration.className?.includes("git-gutter-deleted")
                  ? `Line ${lineNumber + 1}: ${decoration.content || "1"} line(s) deleted`
                  : undefined
          }
        >
          {/* Show content for deleted lines */}
          {decoration.className?.includes("git-gutter-deleted") && decoration.content && (
            <span
              style={{
                position: "absolute",
                left: "6px",
                top: "-1px",
                fontSize: "9px",
                color: "#dc3545",
                fontWeight: "600",
                lineHeight: "1",
                whiteSpace: "nowrap",
                backgroundColor: "rgba(220, 53, 69, 0.1)",
                padding: "1px 3px",
                borderRadius: "2px",
                border: "1px solid rgba(220, 53, 69, 0.3)",
              }}
            />
          )}
        </div>
      ))}

      {/* Line numbers */}
      {showLineNumbers && (
        <span
          className="line-number"
          style={{
            position: "relative",
            zIndex: 2,
            fontSize: "12px",
            color: "var(--color-text-lighter, #6b7280)",
            fontFamily: "inherit",
            userSelect: "none",
            textAlign: "right",
            minWidth: `${gutterWidth - 8}px`,
            paddingRight: "4px",
          }}
        >
          {lineNumber + 1}
        </span>
      )}

      {/* Other decorations (breakpoints, errors, etc.) */}
      {otherDecorations
        .filter((d) => d.content)
        .map((decoration, index) => (
          <span
            key={`other-decoration-${index}`}
            className={cn("gutter-decoration", decoration.className)}
            style={{
              position: "absolute",
              right: "4px",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 3,
            }}
          >
            {decoration.content}
          </span>
        ))}
    </div>
  );
};
