import type { ForwardedRef, RefObject } from "react";
import { forwardRef, useCallback, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import Input from "@/ui/input";

interface RenameInputProps {
  symbol: string;
  line: number;
  column: number;
  fontSize: number;
  lineHeight: number;
  charWidth: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

const RenameInput = forwardRef(
  (
    {
      symbol,
      line,
      fontSize,
      lineHeight,
      charWidth,
      inputRef,
      onSubmit,
      onCancel,
    }: RenameInputProps,
    ref: ForwardedRef<HTMLDivElement>,
  ) => {
    const [value, setValue] = useState(symbol);

    const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

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
            left: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT}px`,
          }}
        >
          <div className="flex items-center gap-1 rounded-md border border-accent/60 bg-secondary-bg p-0.5 shadow-lg">
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
