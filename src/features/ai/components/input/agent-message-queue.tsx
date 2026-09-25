import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PenIcon,
  TrashIcon,
  XIcon,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import { ButtonGroup } from "@/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/ui/item";
import Textarea from "@/ui/textarea";
import type { QueuedAgentMessage } from "@/features/ai/types/ai-chat.types";

interface AgentMessageQueueProps {
  messages: QueuedAgentMessage[];
  onUpdate: (index: number, content: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: (index: number) => void;
  onSendNow: (index: number) => void;
}

function imageCountLabel(message: QueuedAgentMessage): string {
  const count = message.images?.length ?? 0;
  if (count === 0) return "";
  return `${count} image${count === 1 ? "" : "s"} attached`;
}

/** Follow-ups typed while the agent runs, shown above the composer until they are sent. */
export function AgentMessageQueue({
  messages,
  onUpdate,
  onMove,
  onRemove,
  onSendNow,
}: AgentMessageQueueProps) {
  const [isOpen, setIsOpen] = useState(true);
  // Held by reference: the queue can shift while the user types if a turn ends.
  const [editing, setEditing] = useState<{ message: QueuedAgentMessage; draft: string } | null>(
    null,
  );

  if (messages.length === 0) return null;

  const saveEdit = () => {
    if (!editing) return;
    const index = messages.indexOf(editing.message);
    setEditing(null);
    if (index === -1) return;
    // A message needs text or images; clearing an image-less one discards it.
    if (!editing.draft.trim() && !editing.message.images?.length) onRemove(index);
    else onUpdate(index, editing.draft);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        render={<Button type="button" variant="ghost" size="xs" width="full" align="between" />}
      >
        <span>
          {messages.length} queued message{messages.length === 1 ? "" : "s"}
        </span>
        {isOpen ? <ChevronDownIcon /> : <ChevronUpIcon />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ItemGroup aria-label="Queued messages">
          {messages.map((message, index) => {
            const images = imageCountLabel(message);
            const isEditing = editing?.message === message;
            return (
              <Item
                key={`${index}-${message.content}`}
                variant="muted"
                size="compact"
                role="listitem"
              >
                <ItemContent>
                  <ItemTitle>{index === 0 ? "Sends next" : `Sends #${index + 1}`}</ItemTitle>
                  {isEditing ? (
                    <Textarea
                      autoFocus
                      autoSize
                      resize="none"
                      aria-label="Queued message text"
                      value={editing.draft}
                      onChange={(event) => setEditing({ message, draft: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          saveEdit();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                  ) : (
                    <ItemDescription>
                      {message.content || images}
                      {message.content && images ? ` (${images})` : ""}
                    </ItemDescription>
                  )}
                </ItemContent>
                <ItemActions>
                  {isEditing ? (
                    <ButtonGroup variant="ghost">
                      <Button
                        type="button"
                        variant="ghost"
                        iconOnly
                        onClick={saveEdit}
                        tooltip="Save queued message"
                        shortcut="enter"
                      >
                        <CheckIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        iconOnly
                        onClick={() => setEditing(null)}
                        tooltip="Cancel editing"
                        shortcut="escape"
                      >
                        <XIcon />
                      </Button>
                    </ButtonGroup>
                  ) : (
                    <ButtonGroup variant="ghost">
                      <Button
                        type="button"
                        variant="ghost"
                        tone="accent"
                        iconOnly
                        onClick={() => onSendNow(index)}
                        tooltip="Send now"
                      >
                        <BoltIcon />
                      </Button>
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
                        onClick={() => setEditing({ message, draft: message.content })}
                        tooltip="Edit queued message"
                      >
                        <PenIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        tone="danger"
                        iconOnly
                        onClick={() => onRemove(index)}
                        tooltip="Remove queued message"
                      >
                        <TrashIcon />
                      </Button>
                    </ButtonGroup>
                  )}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}
