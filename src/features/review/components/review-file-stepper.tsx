import { CaretLeftIcon as CaretLeft, CaretRightIcon as CaretRight } from "@/ui/icons";
import { motion } from "motion/react";
import { memo, useEffect, useMemo } from "react";
import type { FileNavigatorItem } from "@/features/file-explorer/components/file-navigator-sidebar";
import { Button } from "@/ui/button";
import { Kbd } from "@/ui/kbd";
import { ProgressCircle } from "@/ui/progress";
import { quickTransition } from "@/utils/motion";

interface ReviewFileStepperProps {
  items: FileNavigatorItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isActive?: boolean;
}

type ReviewFileNavigationShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export function getReviewFileNavigationDirection(
  event: ReviewFileNavigationShortcutEvent,
): -1 | 1 | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key.toLowerCase() === "j") return -1;
  if (event.key.toLowerCase() === "k") return 1;
  return null;
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      Boolean(target.closest("input, textarea, select, [contenteditable]")))
  );
}

function ReviewFileProgress({ current, total }: { current: number; total: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      role="status"
      aria-label={`File ${current} of ${total}`}
    >
      <ProgressCircle value={total > 0 ? (current / total) * 100 : 0} />
      <span className="ui-text-sm text-foreground tabular-nums">
        {current}/{total}
      </span>
    </span>
  );
}

export const ReviewFileStepper = memo(function ReviewFileStepper({
  items,
  selectedKey,
  onSelect,
  isActive = true,
}: ReviewFileStepperProps) {
  const selectedIndex = useMemo(() => {
    const index = items.findIndex((item) => item.key === selectedKey);
    return index >= 0 ? index : 0;
  }, [items, selectedKey]);
  const selectedItem = items[selectedIndex] ?? null;
  const previousItem = items[selectedIndex - 1] ?? null;
  const nextItem = items[selectedIndex + 1] ?? null;

  useEffect(() => {
    if (!isActive) return;

    const handleNavigationShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;

      const direction = getReviewFileNavigationDirection(event);
      const item = direction === -1 ? previousItem : direction === 1 ? nextItem : null;
      if (!item) return;

      event.preventDefault();
      onSelect(item.key);
    };

    document.addEventListener("keydown", handleNavigationShortcut, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleNavigationShortcut, { capture: true });
  }, [isActive, nextItem, onSelect, previousItem]);

  if (items.length < 2 || !selectedItem) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={quickTransition}
      className="pointer-events-auto w-fit max-w-full"
    >
      <div
        role="group"
        aria-label="Changed file navigation"
        className="flex w-fit max-w-full items-center justify-between gap-1 rounded-xl border border-border/70 bg-surface/80 p-1 shadow-(--shadow-popover) backdrop-blur-xl"
        data-slot="review-file-stepper"
      >
        <Button
          type="button"
          variant="ghost"
          onClick={() => previousItem && onSelect(previousItem.key)}
          disabled={!previousItem}
          tooltip="Previous changed file"
          shortcut="J"
          aria-label="Previous changed file"
          className="shrink-0"
        >
          <CaretLeft />
          <Kbd>J</Kbd>
        </Button>
        <div className="flex shrink-0 items-center justify-center px-1.5">
          <ReviewFileProgress current={selectedIndex + 1} total={items.length} />
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => nextItem && onSelect(nextItem.key)}
          disabled={!nextItem}
          tooltip="Next changed file"
          shortcut="K"
          aria-label="Next changed file"
          className="shrink-0"
        >
          <Kbd>K</Kbd>
          <CaretRight />
        </Button>
      </div>
    </motion.div>
  );
});
