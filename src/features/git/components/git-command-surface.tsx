import type { KeyboardEventHandler, ReactNode, RefObject } from "react";
import { useEffect, useRef } from "react";
import Command, {
  CommandHeader,
  CommandHeaderBadge,
  CommandInput,
  CommandTabs,
} from "@/ui/command";

export const GIT_COMMAND_SECTIONS = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "remotes", label: "Remotes" },
  { id: "tags", label: "Tags" },
  { id: "stashes", label: "Stashes" },
] as const;

export type GitCommandSection = (typeof GIT_COMMAND_SECTIONS)[number]["id"];

export function GitCommandWorkspace({
  section,
  onSectionChange,
  onClose,
  children,
  query,
  onQueryChange,
}: {
  section: GitCommandSection | null;
  onSectionChange: (section: GitCommandSection) => void;
  onClose: () => void;
  children: ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <GitCommandSurface
      isOpen={section !== null}
      onClose={onClose}
      query={query}
      onQueryChange={onQueryChange}
      placeholder={
        section === "history" ? "Search commits..." : `Search ${section ?? "changes"}...`
      }
      title="Source Control"
      headerAddon={
        <CommandTabs
          ariaLabel="Source Control sections"
          layout="fit"
          items={GIT_COMMAND_SECTIONS.map((item) => ({
            ...item,
            isActive: item.id === section,
            onSelect: () => onSectionChange(item.id),
          }))}
        />
      }
    >
      {children}
    </GitCommandSurface>
  );
}

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
  title?: string;
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
  title,
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
    <Command isVisible={isOpen} onClose={onClose} title={title}>
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
