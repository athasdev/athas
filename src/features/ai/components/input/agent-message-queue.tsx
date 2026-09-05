import { ArrowDownIcon, ArrowUpIcon, ListIcon, PencilSimpleIcon, TrashIcon } from "@/ui/icons";
import { Button } from "@/ui/button";
import { ButtonGroup } from "@/ui/button-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/ui/popover";
import type { QueuedAgentMessage } from "@/features/ai/types/ai-chat.types";

interface AgentMessageQueueProps {
  messages: QueuedAgentMessage[];
  onEdit: (index: number) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
}

export function AgentMessageQueue({ messages, onEdit, onMove, onRemove }: AgentMessageQueueProps) {
  if (messages.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="accent-ghost"
            size="chrome"
            tooltip="Review queued guidance"
            aria-label={`${messages.length} queued message${messages.length === 1 ? "" : "s"}`}
          />
        }
      >
        <ListIcon />
        <span>{messages.length} queued</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end">
        <PopoverHeader>
          <PopoverTitle>Queued guidance</PopoverTitle>
        </PopoverHeader>
        <ItemGroup>
          {messages.map((message, index) => (
            <Item key={`${index}-${message.content}`} variant="muted">
              <ItemContent>
                <ItemTitle>Runs {index === 0 ? "next" : `#${index + 1}`}</ItemTitle>
                <ItemDescription>
                  {message.content}
                  {message.images?.length
                    ? ` (${message.images.length} image${message.images.length === 1 ? "" : "s"} attached)`
                    : ""}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ButtonGroup variant="ghost">
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                    tooltip="Move earlier"
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    disabled={index === messages.length - 1}
                    onClick={() => onMove(index, index + 1)}
                    tooltip="Move later"
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    onClick={() => onEdit(index)}
                    tooltip="Edit queued guidance"
                  >
                    <PencilSimpleIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    iconOnly
                    onClick={() => onRemove(index)}
                    tooltip="Remove queued guidance"
                  >
                    <TrashIcon />
                  </Button>
                </ButtonGroup>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </PopoverContent>
    </Popover>
  );
}
