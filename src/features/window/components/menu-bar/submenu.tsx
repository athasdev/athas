import { CaretRight as ChevronRight } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import Menu from "./menu";

interface Props {
  children: ReactNode;
  title: string;
  disabled?: boolean;
}

const Submenu = ({ title, children, disabled = false }: Props) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => !disabled && setIsOpen(true)}
      // onMouseLeave={() => setIsOpen(false)}
    >
      {/* Submenu trigger */}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className={cn(
          "ui-font ui-text-sm flex h-auto w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-text transition-colors hover:bg-hover",
          disabled && "cursor-not-allowed text-text-lighter",
        )}
      >
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">{title}</span>
        <ChevronRight className="ml-2 shrink-0" />
      </Button>

      {/* Submenu content */}
      {isOpen && !disabled && (
        <div className="absolute top-0 left-full z-[10050] ml-1">
          <Menu>{children}</Menu>
        </div>
      )}
    </div>
  );
};

export default Submenu;
