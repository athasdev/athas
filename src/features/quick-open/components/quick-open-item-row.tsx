import { memo } from "react";
import { CommandItemRow } from "@/ui/command";
import type { QuickOpenItem } from "../types/quick-open.types";

interface QuickOpenItemRowProps {
  item: QuickOpenItem;
  index: number;
  isSelected: boolean;
  onHover: (index: number) => void;
}

export const QuickOpenItemRow = memo(function QuickOpenItemRow({
  item,
  index,
  isSelected,
  onHover,
}: QuickOpenItemRowProps) {
  return (
    <CommandItemRow
      as="div"
      id={`quick-open-option-${index}`}
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      data-item-index={index}
      onClick={item.select}
      onMouseMove={() => onHover(index)}
      isSelected={isSelected}
      icon={item.icon}
      title={item.title}
      description={item.description}
      accessory={item.accessory}
    />
  );
});
