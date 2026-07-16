import { useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Dropdown, type DropdownDensity, type MenuItem } from "@/ui/dropdown";
import { DotsThreeIcon as MoreHorizontal } from "@/ui/icons";
import { cn } from "@/utils/cn";

interface ActionMenuProps {
  items: MenuItem[];
  label?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
  density?: DropdownDensity;
  showIcons?: boolean;
}

export function ActionMenu({
  items,
  label = "More actions",
  disabled = false,
  className,
  menuClassName,
  align = "end",
  side = "bottom",
  density = "compact",
  showIcons = false,
}: ActionMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div ref={anchorRef} className={cn("relative inline-flex shrink-0", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        active={isOpen}
        disabled={disabled}
        tooltip={label}
        tooltipSide={side === "bottom" ? "bottom" : "top"}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <MoreHorizontal />
      </Button>
      <Dropdown
        isOpen={isOpen}
        anchorRef={anchorRef}
        anchorSide={side}
        anchorAlign={align}
        items={items}
        onClose={() => setIsOpen(false)}
        density={density}
        showIcons={showIcons}
        className={cn("min-w-[180px]", menuClassName)}
      />
    </div>
  );
}
