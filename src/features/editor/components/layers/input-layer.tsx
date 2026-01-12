/**
 * Input Layer - Transparent textarea for user input
 * Browser handles cursor, selection, and all editing naturally
 * Uses uncontrolled input for optimal typing performance
 */

import { memo, useCallback, useLayoutEffect, useRef } from "react";

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
  showText?: boolean;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const InputLayerComponent = ({
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
  showText = false,
  textareaRef,
}: InputLayerProps) => {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef || localRef;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onInput(e.target.value);
    },
    [onInput],
  );

  // Sync textarea value when buffer switches
  // Uses useLayoutEffect to run before parent's scroll restoration
  useLayoutEffect(() => {
    if (ref.current && ref.current.value !== content) {
      ref.current.value = content;
    }
  }, [bufferId, content, ref]);

  return (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      defaultValue={content}
      onChange={handleChange}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onSelect={onSelect}
      onClick={onClick}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      onScroll={onScroll}
      className="input-layer editor-textarea editor-viewport"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "auto",
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
        tabSize,
        ...(showText && { color: "var(--text, #d4d4d4)" }),
      }}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      aria-label="Code editor input"
    />
  );
};

InputLayerComponent.displayName = "InputLayer";

export const InputLayer = memo(InputLayerComponent, (prev, next) => {
  return (
    prev.bufferId === next.bufferId &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.showText === next.showText &&
    prev.textareaRef === next.textareaRef &&
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
