import { forwardRef } from "react";
import type { InlineAutocompletePreviewModel } from "@/features/editor/engines/athas/utils/inline-autocomplete-preview";

interface InlineAutocompletePreviewProps {
  preview: InlineAutocompletePreviewModel | null;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
}

export const InlineAutocompletePreview = forwardRef<HTMLDivElement, InlineAutocompletePreviewProps>(
  function InlineAutocompletePreview({ preview, fontSize, fontFamily, lineHeight }, ref) {
    if (!preview) return null;

    return (
      <div ref={ref} className="pointer-events-none absolute inset-0 z-[3]">
        <div
          style={{
            position: "absolute",
            top: `${preview.top}px`,
            left: 0,
            fontSize: `${fontSize}px`,
            fontFamily,
            lineHeight: `${lineHeight}px`,
            whiteSpace: "pre",
            opacity: 0.42,
            color: "var(--text-lighter, #94a3b8)",
          }}
        >
          {preview.lines.map((line) => {
            if (line.text.length === 0) return null;
            return (
              <div
                key={line.index}
                style={{
                  position: "absolute",
                  top: `${line.index * lineHeight}px`,
                  left:
                    line.index === 0
                      ? `${preview.firstLineLeft}px`
                      : `${preview.continuationLeft}px`,
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);

export function InlineAutocompleteHint() {
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-40 rounded-md bg-primary-bg/80 px-2 py-1 ui-text-sm text-text-lighter/80">
      Tab to accept AI suggestion
    </div>
  );
}
