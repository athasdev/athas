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

  return (
    <div
      className={cn(
        "editor-gutter mr-2",
        isBreakpoint && "has-breakpoint",
        hasError && "has-error",
        hasWarning && "has-warning",
      )}
      style={{ width: `${gutterWidth}px` }}
      data-line-number={lineNumber}
    >
      {[
        showLineNumbers && (
          <span key="line-number" className="line-number">
            {lineNumber + 1}
          </span>
        ),
        ...gutterDecorations
          .filter((d) => d.content)
          .map((decoration, index) => (
            <span
              key={`decoration-${index}`}
              className={cn("gutter-decoration", decoration.className)}
            >
              {decoration.content}
            </span>
          )),
      ].filter(Boolean)}
    </div>
  );
};
