/**
 * Input Layer - Transparent textarea for user input
 * Browser handles cursor, selection, and all editing naturally
 * Uses uncontrolled input for optimal typing performance
 */

import { memo, useCallback, useRef } from "react";
import { useSettingsStore } from "@/features/settings/store";

interface InputLayerProps {
  content: string;
  onInput: (content: string, event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBeforeInput?: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onKeyUp?: () => void;
  onSelect?: () => void;
  onClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onMouseUp?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  onScroll?: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  bufferId?: string;
  filePath?: string;
  showText?: boolean;
  readOnly?: boolean;
  scrollable?: boolean;
  customCaret?: boolean;
  nativeSelection?: boolean;
  scrollPaddingBottom?: number;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const InputLayerComponent = ({
  content,
  onInput,
  onBeforeInput,
  onKeyDown,
  onKeyUp,
  onSelect,
  onClick,
  onMouseDown,
  onMouseUp,
  onContextMenu,
  onPaste,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  wordWrap,
  onScroll,
  showText = false,
  readOnly = false,
  scrollable = true,
  customCaret = false,
  nativeSelection = false,
  scrollPaddingBottom = 0,
  textareaRef,
}: InputLayerProps) => {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef || localRef;
  const horizontalBufferCarousel = useSettingsStore((state) => state.settings.horizontalTabScroll);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onInput(e.target.value, e);
    },
    [onInput],
  );

  return (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      defaultValue={content}
      onBeforeInput={onBeforeInput}
      onChange={handleChange}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onSelect={onSelect}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      onPaste={onPaste}
      onScroll={onScroll}
      className={`input-layer editor-textarea editor-viewport ${
        nativeSelection
          ? "native-selection"
          : customCaret || !wordWrap
            ? "selection-transparent"
            : "native-selection"
      }`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflowY: scrollable ? "auto" : "clip",
        overflowX: scrollable && !(wordWrap || horizontalBufferCarousel) ? "auto" : "hidden",
        overscrollBehaviorY: scrollable ? undefined : "none",
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
        caretColor: customCaret ? "transparent" : undefined,
        tabSize,
        whiteSpace: wordWrap ? "pre-wrap" : "pre",
        overflowWrap: wordWrap ? "anywhere" : "normal",
        wordBreak: wordWrap ? "break-word" : "normal",
        paddingBottom:
          scrollPaddingBottom > 0
            ? `calc(var(--editor-padding-bottom) + ${scrollPaddingBottom}px)`
            : undefined,
        ...(showText && { color: "var(--text, #d4d4d4)" }),
      }}
      wrap={wordWrap ? "soft" : "off"}
      spellCheck={false}
      readOnly={readOnly}
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
    prev.filePath === next.filePath &&
    prev.content === next.content &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.wordWrap === next.wordWrap &&
    prev.showText === next.showText &&
    prev.scrollable === next.scrollable &&
    prev.customCaret === next.customCaret &&
    prev.nativeSelection === next.nativeSelection &&
    prev.scrollPaddingBottom === next.scrollPaddingBottom &&
    prev.textareaRef === next.textareaRef &&
    prev.onInput === next.onInput &&
    prev.onBeforeInput === next.onBeforeInput &&
    prev.onKeyDown === next.onKeyDown &&
    prev.onScroll === next.onScroll &&
    prev.onSelect === next.onSelect &&
    prev.onKeyUp === next.onKeyUp &&
    prev.onClick === next.onClick &&
    prev.onMouseDown === next.onMouseDown &&
    prev.onMouseUp === next.onMouseUp &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onPaste === next.onPaste &&
    prev.readOnly === next.readOnly
  );
});
