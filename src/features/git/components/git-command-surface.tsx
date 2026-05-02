import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import Command, { CommandHeader, CommandInput } from "@/ui/command";

interface GitCommandSurfaceProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  meta?: ReactNode;
  children: ReactNode;
}

const GitCommandSurface = ({
  isOpen,
  onClose,
  query,
  onQueryChange,
  placeholder,
  meta,
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
    <Command
      isVisible={isOpen}
      onClose={onClose}
      className="max-h-[70vh] w-[min(560px,calc(100vw_-_32px))]"
    >
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={onQueryChange}
          placeholder={placeholder}
          className="ui-font"
        />
        {meta ? <div className="ui-font ui-text-xs shrink-0 text-text-lighter">{meta}</div> : null}
      </CommandHeader>
      {children}
    </Command>
  );
};

export default GitCommandSurface;
