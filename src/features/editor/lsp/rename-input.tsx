import type { ForwardedRef, RefObject } from "react";
import { forwardRef, useCallback, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import Input from "@/ui/input";
import type { EditorModelPositionResolver } from "../view-model/view-layout";

interface RenameInputProps {
  symbol: string;
  line: number;
  column: number;
  fontSize: number;
  lineHeight: number;
  charWidth: number;
  resolveModelPosition?: EditorModelPositionResolver;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

const RenameInput = forwardRef(
  (
    {
      symbol,
      line,
      column,
      fontSize,
      lineHeight,
      charWidth,
      resolveModelPosition,
      inputRef,
      onSubmit,
      onCancel,
    }: RenameInputProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const [value, setValue] = useState(symbol);

    const resolvedPosition = resolveModelPosition?.(line, column);
    const top = resolvedPosition?.top ?? line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const left = resolvedPosition?.left ?? EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onSubmit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation();
      },
      [value, onSubmit, onCancel],
    );

    return (
      <div
        ref={ref}
        className="pointer-events-auto absolute inset-0 overflow-hidden"
        style={{ zIndex: 50 }}
      >
        <div
          className="absolute"
          style={{
            top: `${top}px`,
            left: `${left}px`,
          }}
        >
          <div className="flex items-center gap-1 rounded-md border border-accent/60 bg-secondary-bg p-0.5 shadow-[var(--shadow-popover)]">
            <Input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={onCancel}
              className="ui-font h-6 min-w-[120px] rounded border-none bg-primary-bg px-1.5 text-text"
              style={{
                fontSize: `${fontSize}px`,
                width: `${Math.max(value.length, symbol.length) * charWidth + 24}px`,
              }}
              aria-label="Rename symbol"
            />
          </div>
        </div>
      </div>
    );
  },
);

RenameInput.displayName = "RenameInput";

export default RenameInput;
