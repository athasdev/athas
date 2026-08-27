import { useId } from "react";
import { Button } from "@/ui/button";
import { SparkleIcon as Sparkles } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

interface EditorSelectionAgentActionProps {
  anchorRect: { x: number; y: number; width: number; height: number };
  onClose: () => void;
  onSelect: () => void;
}

export function EditorSelectionAgentAction({
  anchorRect,
  onClose,
  onSelect,
}: EditorSelectionAgentActionProps) {
  const triggerId = useId();
  const anchorX = anchorRect.x + anchorRect.width / 2;

  return (
    <Popover
      open
      modal={false}
      triggerId={triggerId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverTrigger
        id={triggerId}
        nativeButton={false}
        render={
          <span
            aria-hidden
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: anchorX, top: anchorRect.y }}
          />
        }
      />
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={8}
        initialFocus={false}
        role="toolbar"
        aria-label="Selected code actions"
        className="w-fit p-1"
      >
        <Button
          type="button"
          variant="ghost"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onSelect}
        >
          <Sparkles />
          Edit with agent
        </Button>
      </PopoverContent>
    </Popover>
  );
}
