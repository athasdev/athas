import type { KeyboardEventHandler, ReactNode, RefObject } from "react";
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
  inputRef?: RefObject<HTMLInputElement | null>;
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
  inputRef,
  children,
}: GitCommandSurfaceProps) => {
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const resolvedInputRef = inputRef ?? fallbackInputRef;

  useEffect(() => {
    if (!isOpen) return;

    const frame = requestAnimationFrame(() => {
      resolvedInputRef.current?.focus();
      resolvedInputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen, resolvedInputRef]);

  return (
    <Command isVisible={isOpen} onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={resolvedInputRef}
          value={query}
          onChange={onQueryChange}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="font-sans"
        />
        {meta ? <CommandHeaderBadge>{meta}</CommandHeaderBadge> : null}
      </CommandHeader>
      {headerAddon}
      {children}
    </Command>
  );
};

export default GitCommandSurface;
