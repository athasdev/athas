import type { KeyboardEventHandler, ReactNode } from "react";
import { useEffect, useRef } from "react";
import Command, { CommandHeader, CommandInput } from "@/ui/command";

interface GitCommandSurfaceProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  meta?: ReactNode;
  headerAddon?: ReactNode;
  placement?: "top" | "bottom";
  children: ReactNode;
}

const GitCommandSurface = ({
  isOpen,
  onClose,
  query,
  onQueryChange,
  onInputKeyDown,
  placeholder,
  meta,
  headerAddon,
  placement = "top",
  children,
}: GitCommandSurfaceProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <Command isVisible={isOpen} onClose={onClose} placement={placement}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="ui-font"
        />
        {meta ? (
          <div className="ui-font ui-text-base shrink-0 text-text-lighter">{meta}</div>
        ) : null}
      </CommandHeader>
      {headerAddon}
      {children}
    </Command>
  );
};

export default GitCommandSurface;
