import {
  forwardRef,
  memo,
  type ClipboardEventHandler,
  type MouseEventHandler,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type UIEventHandler,
} from "react";

interface LargeEditorSurfaceProps {
  scrollHeight: number;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}

const LargeEditorSurfaceComponent = forwardRef<HTMLDivElement, LargeEditorSurfaceProps>(
  (
    {
      scrollHeight,
      onKeyDown,
      onPaste,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onContextMenu,
      onScroll,
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className="absolute inset-0 z-[5] cursor-text overflow-auto bg-transparent outline-none"
        data-large-editor-scroll
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        onScroll={onScroll}
        aria-label="Large file editor viewport"
      >
        <div
          aria-hidden="true"
          style={{
            width: 1,
            height: scrollHeight,
          }}
        />
      </div>
    );
  },
);

LargeEditorSurfaceComponent.displayName = "LargeEditorSurface";

export const LargeEditorSurface = memo(LargeEditorSurfaceComponent);
