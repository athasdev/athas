import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { CodeIcon, MagicWandIcon, PenIcon, PlayIcon, TerminalIcon, TrashIcon } from "@/ui/icons";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/ui/item";
import type { RunActionItem } from "../types/run-action.types";

interface RunActionRowProps {
  action: RunActionItem;
  onRun: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function SourceIcon({ source }: { source: RunActionItem["source"] }) {
  if (source === "custom") return <TerminalIcon />;
  if (source === "lsp") return <CodeIcon />;
  return <MagicWandIcon />;
}

export default function RunActionRow({ action, onRun, onEdit, onDelete }: RunActionRowProps) {
  const detail = action.command ?? action.description;

  return (
    <Item
      size="xs"
      className="min-h-11 flex-nowrap px-1.5 py-1 hover:bg-accent focus-within:bg-accent"
    >
      <button
        type="button"
        onClick={onRun}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none"
      >
        <ItemMedia className="grid size-6 rounded-md bg-surface text-subtle-foreground">
          <SourceIcon source={action.source} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="gap-1.5 font-normal">
            <span className="truncate">{action.name}</span>
            <Badge size="compact" variant={action.source === "lsp" ? "accent" : "muted"}>
              {action.sourceLabel}
            </Badge>
          </ItemTitle>
          {detail ? (
            <ItemDescription className="block truncate font-mono">{detail}</ItemDescription>
          ) : null}
        </ItemContent>
      </button>

      {onEdit || onDelete ? (
        <ItemActions className="gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100">
          {onEdit ? (
            <Button
              type="button"
              onClick={onEdit}
              variant="ghost"
              size="icon-xs"
              className="text-subtle-foreground"
              aria-label={`Edit ${action.name}`}
            >
              <PenIcon />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              type="button"
              onClick={onDelete}
              variant="ghost"
              size="icon-xs"
              className="text-subtle-foreground hover:text-destructive"
              aria-label={`Delete ${action.name}`}
            >
              <TrashIcon />
            </Button>
          ) : null}
        </ItemActions>
      ) : (
        <PlayIcon className="mr-1 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
      )}
    </Item>
  );
}
