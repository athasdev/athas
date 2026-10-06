import { useId } from "react";
import { Button } from "@/ui/button";
import { ChatBubbleTextIcon, SparkleIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

interface EditorSelectionAgentActionProps {
  anchorRect: { x: number; y: number; width: number; height: number };
  onClose: () => void;
  /** Rewrites the selection in place with inline edit. */
  onEdit: () => void;
  /** Sends the selection to the agent chat as context. */
  onAddToChat: () => void;
}

/** The small toolbar above selected code: edit it inline, or hand it to the agent chat. */
export function EditorSelectionAgentAction({
  anchorRect,
  onClose,
  onEdit,
  onAddToChat,
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
        size="auto"
        className="p-1"
      >
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            tooltip="Edit selection inline"
            commandId="editor.inlineEdit"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onEdit}
          >
            <SparkleIcon />
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Add to chat"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onAddToChat}
          >
            <ChatBubbleTextIcon />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
