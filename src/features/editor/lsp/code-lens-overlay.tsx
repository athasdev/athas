import { type ForwardedRef, forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { EditorModelPositionResolver } from "../view-model/view-layout";
import type { CodeLensItem } from "./use-code-lens";

interface CodeLensOverlayProps {
  lenses: CodeLensItem[];
  fontSize: number;
  lineHeight: number;
  scrollTop: number;
  viewportHeight: number;
  contentLeft: number;
  getLineText?: (line: number) => string | undefined;
  onExecute?: (lens: CodeLensItem) => void;
  resolveModelPosition?: EditorModelPositionResolver;
}

interface ResolvedLensPosition {
  top: number;
  left: number;
}

const CodeLensOverlay = forwardRef(
  (
    {
      lenses,
      fontSize,
      lineHeight,
      scrollTop,
      viewportHeight,
      contentLeft,
      getLineText,
      onExecute,
      resolveModelPosition,
    }: CodeLensOverlayProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const [resolvedPositions, setResolvedPositions] = useState<Map<number, ResolvedLensPosition>>(
      new Map(),
    );

    useEffect(() => {
      if (!resolveModelPosition || lenses.length === 0) {
        setResolvedPositions(new Map());
        return;
      }

      const nextPositions = new Map<number, ResolvedLensPosition>();
      for (const line of new Set(lenses.map((lens) => lens.line))) {
        const startPosition = resolveModelPosition(line, 0);
        if (!startPosition || typeof startPosition.top !== "number") continue;

        const lineText = getLineText?.(line) ?? "";
        const endPosition = lineText ? resolveModelPosition(line, lineText.length) : startPosition;
        const inlineLeft =
          typeof endPosition?.left === "number"
            ? endPosition.left
            : typeof startPosition.left === "number"
              ? startPosition.left
              : 0;

        nextPositions.set(line, {
          top: startPosition.top,
          left: contentLeft + Math.max(0, inlineLeft) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        });
      }

      setResolvedPositions(nextPositions);
    }, [contentLeft, getLineText, lenses, resolveModelPosition]);

    const getLensPosition = useCallback(
      (line: number) => {
        const resolved = resolvedPositions.get(line);
        if (resolved) return resolved;
        return {
          top: EDITOR_CONSTANTS.EDITOR_PADDING_TOP + line * lineHeight,
          left: contentLeft + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
        };
      },
      [contentLeft, lineHeight, resolvedPositions],
    );

    // Group lenses by line and only render visible ones
    const visibleGroups = useMemo(() => {
      const buffer = viewportHeight * 0.5;
      const visibleTop = Math.max(0, scrollTop - buffer);
      const visibleBottom = scrollTop + viewportHeight + buffer;

      const byLine = new Map<number, CodeLensItem[]>();
      for (const lens of lenses) {
        if (!lens.command) continue;

        const top = getLensPosition(lens.line).top;
        if (top < visibleTop || top > visibleBottom) continue;
        const existing = byLine.get(lens.line) || [];
        existing.push(lens);
        byLine.set(lens.line, existing);
      }
      return byLine;
    }, [getLensPosition, lenses, scrollTop, viewportHeight]);

    if (visibleGroups.size === 0) return null;

    return (
      <div
        ref={ref}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 4 }}
      >
        {Array.from(visibleGroups.entries()).map(([line, items]) => {
          const position = getLensPosition(line);
          const top = Math.max(0, position.top + lineHeight * 0.1);
          const left = Math.max(contentLeft, position.left);

          return (
            <div
              key={line}
              className="absolute"
              style={{
                top: `${top}px`,
                left: `${left}px`,
                fontSize: `${fontSize * 0.8}px`,
                lineHeight: `${lineHeight * 0.8}px`,
                maxWidth: `calc(100% - ${left + 16}px)`,
              }}
            >
              {items.map((item, i) => (
                <button
                  key={`${item.title}-${i}`}
                  type="button"
                  className="pointer-events-auto mr-2 cursor-pointer border-none bg-transparent p-0 editor-font text-text-lighter/60 hover:text-text"
                  disabled={!item.command}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (item.command) onExecute?.(item);
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    );
  },
);

CodeLensOverlay.displayName = "CodeLensOverlay";

export default CodeLensOverlay;
