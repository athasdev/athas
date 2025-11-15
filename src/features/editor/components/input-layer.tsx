/**
 * Input Layer - Transparent textarea for user input
 * Browser handles cursor, selection, and all editing naturally
 * Uses uncontrolled input for optimal typing performance
 */

import { forwardRef, memo, useCallback, useEffect } from "react";

interface InputLayerProps {
  content: string;
  onInput: (content: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp?: () => void;
  onSelect?: () => void;
  onClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onMouseUp?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  bufferId?: string;
}

const InputLayerComponent = forwardRef<HTMLTextAreaElement, InputLayerProps>(
  (
    {
      content,
      onInput,
      onKeyDown,
      onKeyUp,
      onSelect,
      onClick,
      onMouseUp,
      onContextMenu,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      onScroll,
      bufferId,
    },
    ref,
  ) => {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onInput(e.target.value);
      },
      [onInput],
    );

    // Sync textarea value ONLY when buffer switches (not during typing)
    // This keeps the textarea fully uncontrolled during typing for zero-lag input
    useEffect(() => {
      if (ref && typeof ref !== "function" && ref.current) {
        if (ref.current.value !== content) {
          ref.current.value = content;
        }
      }
    }, [bufferId, ref]); // Only sync on buffer switch, NOT on content changes

    return (
      <textarea
        ref={ref}
        defaultValue={content}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onSelect={onSelect}
        onClick={onClick}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
        onScroll={onScroll}
        className="input-layer editor-textarea"
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

InputLayerComponent.displayName = "InputLayer";

// Wrap with memo to prevent re-renders during typing
// Only re-render when buffer changes or styling changes
export const InputLayer = memo(InputLayerComponent, (prev, next) => {
  // Skip re-render if only content changed (textarea is uncontrolled during typing)
  // Re-render when buffer switches or styling changes
  return (
    prev.bufferId === next.bufferId &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.onInput === next.onInput &&
    prev.onKeyDown === next.onKeyDown &&
    prev.onScroll === next.onScroll &&
    prev.onSelect === next.onSelect &&
    prev.onKeyUp === next.onKeyUp &&
    prev.onClick === next.onClick &&
    prev.onMouseUp === next.onMouseUp &&
    prev.onContextMenu === next.onContextMenu
  );
});
