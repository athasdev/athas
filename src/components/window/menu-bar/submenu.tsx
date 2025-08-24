import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
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
      <button
        className={cn(
          "flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-text text-xs hover:bg-hover",
          disabled && "cursor-not-allowed text-gray-500",
        )}
        disabled={disabled}
      >
        <span>{title}</span>
        <ChevronRight size={14} className="ml-2" />
      </button>

      {/* Submenu content */}
      {isOpen && !disabled && (
        <div className="absolute top-0 left-full ml-1">
          <Menu>{children}</Menu>
        </div>
      )}
    </div>
  );
};

export default Submenu;
