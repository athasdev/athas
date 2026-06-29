import type { KeyboardEventHandler, ReactNode } from "react";
import { useEffect, useRef } from "react";
import Command, { CommandHeader, CommandHeaderBadge, CommandInput } from "@/ui/command";

interface GitCommandSurfaceProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder: string;
  meta?: ReactNode;
  headerAddon?: ReactNode;
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
    <Command isVisible={isOpen} onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="ui-font"
        />
        {meta ? <CommandHeaderBadge>{meta}</CommandHeaderBadge> : null}
      </CommandHeader>
      {headerAddon}
      {children}
    </Command>
  );
};

export default GitCommandSurface;
