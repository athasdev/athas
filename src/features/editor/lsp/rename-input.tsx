import type { RefObject } from "react";
import { useCallback, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import Input from "@/ui/input";

interface RenameInputProps {
  symbol: string;
  line: number;
  column: number;
  fontSize: number;
  charWidth: number;
  scrollTop: number;
  scrollLeft: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

const RenameInput = ({
  symbol,
  line,
  fontSize,
  charWidth,
  scrollTop,
  scrollLeft,
  inputRef,
  onSubmit,
  onCancel,
}: RenameInputProps) => {
  const [value, setValue] = useState(symbol);

  const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
  const top = line * lineHeight - scrollTop + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;

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
      className="absolute z-50"
      style={{
        top: `${top}px`,
        left: `${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT - scrollLeft}px`,
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
  );
};

export default RenameInput;
