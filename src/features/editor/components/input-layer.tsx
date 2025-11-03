/**
 * Input Layer - Transparent textarea for user input
 * Browser handles cursor, selection, and all editing naturally
 * Uses uncontrolled input for optimal typing performance
 */

import { forwardRef, useCallback, useEffect } from "react";

interface InputLayerProps {
  content: string;
  onInput: (content: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  bufferId?: string;
}

export const InputLayer = forwardRef<HTMLTextAreaElement, InputLayerProps>(
  (
    { content, onInput, onKeyDown, fontSize, fontFamily, lineHeight, tabSize, onScroll, bufferId },
    ref,
  ) => {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onInput(e.target.value);
      },
      [onInput],
    );

    // Sync textarea value only when buffer changes (not on every content change)
    useEffect(() => {
      if (ref && typeof ref !== "function" && ref.current) {
        if (ref.current.value !== content) {
          ref.current.value = content;
        }
      }
    }, [bufferId, ref]); // Only update on buffer change, not content change

    return (
      <textarea
        ref={ref}
        defaultValue={content}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className="input-layer"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          tabSize,
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-label="Code editor input"
      />
    );
  },
);

InputLayer.displayName = "InputLayer";
