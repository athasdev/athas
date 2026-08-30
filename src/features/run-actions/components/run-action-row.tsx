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
    <Item size="compact" className="flex-nowrap hover:bg-accent focus-within:bg-accent">
      <button
        type="button"
        onClick={onRun}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-chrome px-1 text-left outline-none"
      >
        <ItemMedia variant="icon" className="text-subtle-foreground">
          <SourceIcon source={action.source} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="gap-1.5 font-normal leading-row">
            <span className="truncate">{action.name}</span>
            <span
              className={
                action.source === "lsp"
                  ? "shrink-0 text-primary ui-text-chrome"
                  : "shrink-0 text-subtle-foreground ui-text-chrome"
              }
            >
              {action.sourceLabel}
            </span>
          </ItemTitle>
          {detail ? (
            <ItemDescription className="block truncate font-mono leading-row ui-text-chrome">
              {detail}
            </ItemDescription>
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
              iconOnly
              size="chrome"
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
              iconOnly
              size="chrome"
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
